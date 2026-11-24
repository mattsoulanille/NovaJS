import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { Gettable } from 'novadatainterface/gettable';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import type { SystemResourceList } from '../common/system_resources.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { JumpComponent, JumpRouteComponent } from '../nova_plugin/travel/index.js';
import { serveInProcess } from '../test_support/serve_game_data_in_process.js';
import { IdleScheduler, PrefetchBudget } from './background_prefetch.js';
import { ClientState, LiveSystem } from './client_state.js';
import { displayPlayerJumping, displayPlayerNextHop } from './frame_pump.js';
import { meterRoundTrips, RoundTripMeter } from './gamedata/round_trip_meter.js';
import { SimulationGameData } from './gamedata/simulation_game_data.js';
import {
    fetchSystemResources, NextHopAssets, NextHopPrefetch, SystemResourceFetcher,
} from './next_hop_prefetch.js';

const { thessaly, kestrel, ossory, vael } = SYNTHETIC.systems;

/** Display-side caches that record what was asked of them. */
class RecordingAssets implements NextHopAssets {
    readonly asked: string[] = [];
    readonly data: NextHopAssets['data'];
    constructor(failSheets = false) {
        const gettable = (kind: string, fail = false) =>
            new Gettable<never>(async id => {
                this.asked.push(`${kind} ${id}`);
                if (fail) {
                    throw new Error(`no ${kind} ${id}`);
                }
                return {} as never;
            });
        this.data = {
            SpriteSheetFrames: gettable('frames', failSheets),
            SpriteSheetImage: gettable('image'),
            Explosion: gettable('explosion'),
            Sound: gettable('sound'),
        } as unknown as NextHopAssets['data'];
    }
    prefetchPict(id: string) {
        this.asked.push(`pict ${id}`);
        return Promise.resolve();
    }
}

function inSpace(systemId: string): ClientState {
    return { kind: 'inSpace', system: { systemId } as unknown as LiveSystem };
}

const landing: ClientState = { kind: 'entering' };

/** A scheduler whose tasks run only when the spec says so. */
function manualScheduler() {
    const queue: (() => void)[] = [];
    const schedule = ((task: () => void) => { queue.push(task); }) as
        IdleScheduler & { flush(): Promise<void>, size(): number };
    schedule.size = () => queue.length;
    schedule.flush = async () => {
        for (let i = 0; i < 200; i++) {
            for (const task of queue.splice(0)) {
                task();
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    };
    return schedule;
}

const immediately: IdleScheduler = task => setTimeout(task, 0);

async function client(options: { failSheets?: boolean } = {}): Promise<{
    sim: SimulationGameData, meter: RoundTripMeter, assets: RecordingAssets,
    lists: string[], fetchList: SystemResourceFetcher,
}> {
    const served = serveInProcess(await getSyntheticGameData());
    const meter = meterRoundTrips(served);
    const sim = new SimulationGameData('', meter.fetch);
    await sim.loaded;
    await sim.ids;
    meter.reset();
    const lists: string[] = [];
    const fetchFromServer = fetchSystemResources('', served);
    const fetchList = async (id: string) => {
        lists.push(id);
        return fetchFromServer(id);
    };
    return { sim, meter, assets: new RecordingAssets(options.failSheets),
        lists, fetchList };
}

async function listOf(systemId: string): Promise<SystemResourceList> {
    return fetchSystemResources('', serveInProcess(
        await getSyntheticGameData()))(systemId);
}

describe('NextHopPrefetch (#370)', () => {
    it('warms the first hop\'s data and assets, and only that hop', async () => {
        const { sim, meter, assets, lists, fetchList } = await client();
        const prefetch = new NextHopPrefetch(sim, assets, fetchList,
            { schedule: immediately, debug: () => { } });
        prefetch.onState(inSpace(thessaly));
        prefetch.noteNextHop(thessaly, kestrel);
        await prefetch.idle;

        expect(prefetch.done).toBeTrue();
        expect(prefetch.systemId).toBe(kestrel);
        expect(lists).toEqual([kestrel]);
        const list = await listOf(kestrel);
        for (const [type, ids] of Object.entries(list.data)) {
            const gettable = sim.data[type as keyof typeof sim.data];
            for (const id of ids!) {
                expect(id in gettable.gotten || gettable.isMissing(id))
                    .withContext(`${type} ${id}`).toBeTrue();
            }
        }
        // In a few batched requests, not one per id.
        expect(meter.stats.batches).toBeLessThanOrEqual(3);
        expect(assets.asked).toEqual(jasmine.arrayWithExactContents([
            ...list.assets.SpriteSheet.flatMap(id =>
                [`frames ${id}`, `image ${id}`]),
            ...list.assets.Explosion.map(id => `explosion ${id}`),
            ...list.assets.Sound.map(id => `sound ${id}`),
            ...list.assets.Pict.map(id => `pict ${id}`),
        ]));
        expect(list.assets.SpriteSheet.length).toBeGreaterThan(0);
    });

    it('warms nothing without a hop, out of space, or for a stale hop', async () => {
        const { sim, meter, assets, lists, fetchList } = await client();
        const prefetch = new NextHopPrefetch(sim, assets, fetchList,
            { schedule: immediately, debug: () => { } });
        prefetch.onState(inSpace(thessaly));
        prefetch.noteNextHop(thessaly, undefined);
        await prefetch.idle;
        // The hop seen from another system (the pump before the state
        // caught up, or a gate transit since) is not this system's.
        prefetch.noteNextHop(vael, kestrel);
        await prefetch.idle;
        // Not in space: landed, in transit, at the title.
        prefetch.onState(landing);
        prefetch.noteNextHop(thessaly, kestrel);
        await prefetch.idle;
        // A route to where the player already is.
        prefetch.onState(inSpace(kestrel));
        prefetch.noteNextHop(kestrel, kestrel);
        await prefetch.idle;

        expect(lists).toEqual([]);
        expect(meter.stats.requests).toBe(0);
        expect(assets.asked).toEqual([]);
    });

    it('cancels on leaving space or a route change, and restarts for the new hop', async () => {
        const { sim, assets, lists, fetchList } = await client();
        const schedule = manualScheduler();
        const prefetch = new NextHopPrefetch(sim, assets, fetchList,
            { schedule, concurrency: 1, debug: () => { } });
        prefetch.onState(inSpace(thessaly));
        prefetch.noteNextHop(thessaly, kestrel);
        expect(schedule.size()).toBe(1);

        // The route changes before anything ran: the kestrel run is
        // cancelled without issuing anything, an ossory run starts.
        prefetch.noteNextHop(thessaly, ossory);
        const first = prefetch.idle;
        await schedule.flush();
        await first;
        expect(lists).toEqual([ossory]);
        expect(prefetch.systemId).toBe(ossory);
        expect(prefetch.done).toBeTrue();

        // Leaving space mid-run issues nothing more.
        prefetch.noteNextHop(thessaly, kestrel);
        prefetch.onState(landing);
        await schedule.flush();
        await prefetch.idle;
        expect(prefetch.done).toBeFalse();
        expect(lists).toEqual([ossory]);
        const askedWhileLanded = assets.asked.length;

        // Back in space with the same hop: the run resumes.
        prefetch.onState(inSpace(thessaly));
        await schedule.flush();
        await prefetch.idle;
        expect(prefetch.done).toBeTrue();
        expect(lists).toEqual([ossory, kestrel]);
        expect(assets.asked.length).toBeGreaterThan(askedWhileLanded);

        // A finished hop stays finished: nothing is re-issued.
        const asked = assets.asked.length;
        prefetch.onState(landing);
        prefetch.onState(inSpace(thessaly));
        await schedule.flush();
        expect(assets.asked.length).toBe(asked);
    });

    it('fetches each list once, and swallows failures into one debug line', async () => {
        const { sim, assets, lists, fetchList } = await client(
            { failSheets: true });
        const debug: string[] = [];
        const prefetch = new NextHopPrefetch(sim, assets, fetchList,
            { schedule: immediately, debug: line => debug.push(line) });
        prefetch.onState(inSpace(thessaly));
        prefetch.noteNextHop(thessaly, kestrel);
        await prefetch.idle;
        expect(debug.length).toBe(1);
        expect(debug[0]).toContain(kestrel);

        prefetch.noteNextHop(thessaly, ossory);
        await prefetch.idle;
        prefetch.noteNextHop(thessaly, kestrel);
        await prefetch.idle;
        expect(lists).toEqual([kestrel, ossory]);
    });

    it('shares a budget with the other prefetches', async () => {
        const { sim, assets, fetchList } = await client();
        const budget = new PrefetchBudget(2);
        let peak = 0;
        const counting: IdleScheduler = task => setTimeout(() => {
            peak = Math.max(peak, budget.inFlight);
            task();
        }, 0);
        const a = new NextHopPrefetch(sim, assets, fetchList,
            { schedule: counting, budget, debug: () => { } });
        const b = new NextHopPrefetch(sim, new RecordingAssets(), fetchList,
            { schedule: counting, budget, debug: () => { } });
        a.onState(inSpace(thessaly));
        a.noteNextHop(thessaly, kestrel);
        b.onState(inSpace(thessaly));
        b.noteNextHop(thessaly, ossory);
        await Promise.all([a.idle, b.idle]);
        expect(a.done && b.done).toBeTrue();
        expect(peak).toBeLessThanOrEqual(2);
    });

    it('seeds a worker from the main thread\'s cache once it has the list', async () => {
        const { sim, assets, fetchList } = await client();
        const prefetch = new NextHopPrefetch(sim, assets, fetchList,
            { schedule: immediately, debug: () => { } });
        expect(await prefetch.seedFor(kestrel)).toBeUndefined();

        prefetch.onState(inSpace(thessaly));
        prefetch.noteNextHop(thessaly, kestrel);
        await prefetch.idle;
        await sim.getSettings('controls.json');
        const seed = await prefetch.seedFor(kestrel);
        expect(seed?.ids).toEqual(await sim.ids);
        expect(seed?.settings?.['controls.json']).toBeDefined();
        expect(seed?.data['System']?.[kestrel]).toBe(
            await sim.data.System.get(kestrel));
        // Only the list's ids, only what is cached.
        const list = await listOf(kestrel);
        for (const [type, table] of Object.entries(seed!.data)) {
            for (const id of Object.keys(table)) {
                expect(list.data[type as keyof typeof list.data])
                    .withContext(type).toContain(id);
            }
        }
        // Another system's entry gets nothing.
        expect(await prefetch.seedFor(ossory)).toBeUndefined();

        prefetch.disabled = true;
        expect(await prefetch.seedFor(kestrel)).toBeUndefined();
    });
});

describe('displayPlayerNextHop (#370)', () => {
    function world(player: Entity) {
        const w = new World('next hop');
        w.entities.set('npc', new Entity('npc'));
        w.entities.set('player', player);
        return w;
    }

    it('is the route\'s first hop, or the destination of a jump under way', () => {
        const player = new Entity('player');
        player.components.set(PlayerShipSelector, undefined);
        expect(displayPlayerNextHop(world(player))).toBeUndefined();

        player.components.set(JumpRouteComponent, { route: [kestrel, ossory] });
        expect(displayPlayerNextHop(world(player))).toBe(kestrel);

        // The jump starts: the route has moved on, the jump has not.
        player.components.set(JumpRouteComponent, { route: [ossory] });
        player.components.set(JumpComponent,
            { stage: 'stopping', direction: 0, to: kestrel });
        expect(displayPlayerNextHop(world(player))).toBe(kestrel);

        // Arriving: the route's hop again.
        player.components.set(JumpComponent,
            { stage: 'arriving', direction: 0, to: kestrel });
        expect(displayPlayerNextHop(world(player))).toBe(ossory);

        // A ship vanishing goes nowhere.
        player.components.set(JumpComponent,
            { stage: 'departing', direction: 0, to: '', vanish: true } as never);
        expect(displayPlayerNextHop(world(player))).toBeUndefined();
    });
});

describe('displayPlayerJumping (#344)', () => {
    function world(player: Entity) {
        const w = new World('jumping');
        const npc = new Entity('npc');
        // An NPC's jump is not the player's.
        npc.components.set(JumpComponent,
            { stage: 'spinup', direction: 0, to: kestrel });
        w.entities.set('npc', npc);
        w.entities.set('player', player);
        return w;
    }

    it('is the departure stages of the player\'s own jump, not the arrival',
        () => {
            const player = new Entity('player');
            player.components.set(PlayerShipSelector, undefined);
            expect(displayPlayerJumping(world(player))).toBeFalse();
            for (const stage of ['stopping', 'aligning', 'spinup',
                'accelerating'] as const) {
                player.components.set(JumpComponent,
                    { stage, direction: 0, to: kestrel });
                expect(displayPlayerJumping(world(player)))
                    .withContext(stage).toBeTrue();
            }
            player.components.set(JumpComponent,
                { stage: 'arriving', direction: 0, to: kestrel });
            expect(displayPlayerJumping(world(player))).toBeFalse();
            expect(displayPlayerJumping(new World('empty'))).toBeFalse();
        });
});
