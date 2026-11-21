import 'jasmine';
import { Gettable } from 'novadatainterface/gettable';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { StringTableData } from 'novadatainterface/string_table_data';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { BAR_PICT } from '../spaceport/bar.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { Menu } from '../spaceport/menu.js';
import { OUTFITTER_PICT } from '../spaceport/outfitter.js';
import { SHIP_INFO_PICT } from '../spaceport/ship_info.js';
import { SPACEPORT_PICT, Spaceport } from '../spaceport/spaceport.js';
import { TRADE_CENTER_PICT } from '../spaceport/trade_center.js';
import { serveInProcess } from '../test_support/serve_game_data_in_process.js';
import { ClientState, ClientStateSlot, LiveSystem, TransitPlan } from './client_state.js';
import { DisplayAssetDataInterface } from './gamedata/display_asset_data.js';
import { meterRoundTrips, RoundTripMeter } from './gamedata/round_trip_meter.js';
import { SimulationGameData } from './gamedata/simulation_game_data.js';
import {
    IdleScheduler, LandedUiAssets, LandedUiPrefetch, planLandedUi,
} from './landed_ui_prefetch.js';

/**
 * The display side as the landed UI and the prefetch see it, recording
 * instead of loading: a PICT the prefetch warmed is "in the texture
 * cache"; one the UI asks for that is not would be a network round trip
 * at landing. The STR# and sound Gettables are real (cached) ones over
 * the synthetic data, counting their loads.
 */
class RecordingAssets implements LandedUiAssets {
    readonly warm = new Set<string>();
    /** Every PICT the UI drew, in order. */
    readonly drawn: string[] = [];
    readonly prefetched: string[] = [];
    stringTableLoads = 0;
    soundLoads = 0;
    readonly data: LandedUiAssets['data'] & DisplayAssetDataInterface['data'];

    constructor(stringTables: Gettable<StringTableData>) {
        this.data = {
            StringTable: new Gettable<StringTableData>(async id => {
                this.stringTableLoads++;
                return stringTables.get(id);
            }),
            Sound: new Gettable(async () => {
                this.soundLoads++;
                return undefined as never;
            }),
        } as unknown as LandedUiAssets['data'] & DisplayAssetDataInterface['data'];
    }

    prefetchPict(id: string): Promise<void> {
        this.prefetched.push(id);
        this.warm.add(id);
        return Promise.resolve();
    }

    /** The display-asset face the spaceport is built with. */
    get display(): DisplayAssetDataInterface {
        const draw = (id: string) => {
            this.drawn.push(id);
            return new PIXI.Sprite();
        };
        return {
            data: this.data,
            spriteFromPict: draw,
            spriteFromPictAsync: async (id: string) => draw(id),
            textureFromPict: (id: string) => {
                this.drawn.push(id);
                return PIXI.Texture.EMPTY;
            },
            textureFromPictAsync: async (id: string) => {
                this.drawn.push(id);
                return PIXI.Texture.EMPTY;
            },
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
        };
    }
}

function inSpace(systemId: string): ClientState {
    // Only the system id is read; the rest of a LiveSystem is the
    // display world and bridge, which the prefetch never touches.
    return { kind: 'inSpace', system: { systemId } as unknown as LiveSystem };
}

function transitTo(systemId: string): ClientState {
    return {
        kind: 'transit',
        transit: { kind: 'jump', to: systemId } as unknown as TransitPlan,
    };
}

/** A scheduler whose tasks run only when the spec says so. */
type ManualScheduler = IdleScheduler & {
    /** Runs what is queued now (not what that queues). */
    tick(): void,
    /** Runs everything, until the queue stays empty. */
    flush(): Promise<void>,
    size(): number,
};

function manualScheduler(): ManualScheduler {
    const queue: (() => void)[] = [];
    const schedule = ((task: () => void) => { queue.push(task); }) as
        ManualScheduler;
    schedule.size = () => queue.length;
    schedule.tick = () => {
        for (const task of queue.splice(0)) {
            task();
        }
    };
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

async function coldClient(): Promise<{
    sim: SimulationGameData, meter: RoundTripMeter, assets: RecordingAssets,
}> {
    const gameData = await getSyntheticGameData();
    const meter = meterRoundTrips(serveInProcess(gameData));
    const sim = new SimulationGameData('', meter.fetch);
    await sim.loaded;
    await sim.ids;
    meter.reset();
    return { sim, meter, assets: new RecordingAssets(gameData.data.StringTable) };
}

/**
 * Issue #369: on the deployed server (~100 ms round trip) landing waited
 * on its own loads — the spaceport and venue frames, the landscape, the
 * popups' frames, the outfitter's weapon warm-up, the shops' first item
 * pages. Once the player is in space, LandedUiPrefetch warms exactly
 * those caches, so a landing afterwards goes to the network for nothing.
 */
describe('landed-UI prefetch (#369)', () => {
    beforeAll(() => installHeadlessPixi());

    const thessaly = SYNTHETIC.systems.thessaly;
    const port = SYNTHETIC.planets.port;

    it('leaves nothing for a landing at a full-service port to fetch', async () => {
        const { sim, meter, assets } = await coldClient();
        const slot = new ClientStateSlot();
        const prefetch = new LandedUiPrefetch(sim, assets,
            { schedule: immediately, debug: fail });
        prefetch.follow(slot);
        slot.apply(() => inSpace(thessaly));
        await prefetch.idle;
        expect(prefetch.done).toBe(true);

        // Land: the spaceport builds every venue as it opens (frames,
        // buttons, the shop grids' first pages, the outfitter's govt /
        // outfit / weapon warm-up), and the trade center loads its
        // commodities the first time it is shown.
        meter.reset();
        const stringTablesBefore = assets.stringTableLoads;
        const spaceport = new Spaceport(assets.display, sim, port,
            new Subject<ControlEvent>());
        const venues = spaceport as unknown as Record<string, Menu<unknown>>;
        await spaceport.buildPromise;
        await Promise.all(['outfitter', 'shipyard', 'bar', 'tradeCenter',
            'missionComputer'].map(name => venues[name].buildPromise));
        await (venues.tradeCenter as unknown as { load(): Promise<void> })
            .load();

        const known = new Set((await sim.ids).PictImage);
        const cold = [...new Set(assets.drawn)]
            .filter(id => known.has(id) && !assets.warm.has(id));
        expect(cold).withContext('PICTs drawn but not prefetched').toEqual([]);
        expect(meter.stats.requests)
            .withContext(`game-data requests at landing: ${JSON.stringify(meter.stats)}`)
            .toBe(0);
        expect(assets.stringTableLoads - stringTablesBefore).toBe(0);
        // The spaceport really drew from the warmed set (the spec is not
        // vacuous): its frame, the venues', the port's landscape.
        const portData = await sim.data.Planet.get(port);
        for (const id of [SPACEPORT_PICT, OUTFITTER_PICT, BAR_PICT,
            TRADE_CENTER_PICT, portData.landingPict]) {
            expect(assets.drawn).toContain(id);
        }
    });

    it('starts nothing before the player is in space', async () => {
        const { sim, meter, assets } = await coldClient();
        const schedule = manualScheduler();
        const slot = new ClientStateSlot();
        const prefetch = new LandedUiPrefetch(sim, assets, { schedule });
        prefetch.follow(slot);
        slot.apply(() => ({ kind: 'title' }));
        slot.apply(() => ({ kind: 'entering' }));
        await schedule.flush();
        expect(prefetch.systemId).toBeUndefined();
        expect(schedule.size()).toBe(0);
        expect(meter.stats.requests).toBe(0);
        expect(assets.prefetched).toEqual([]);

        slot.apply(() => inSpace(thessaly));
        expect(prefetch.systemId).toBe(thessaly);
        await schedule.flush();
        await prefetch.idle;
        expect(prefetch.done).toBe(true);
        expect(assets.prefetched.length).toBeGreaterThan(0);
    });

    it('stops issuing work when the player jumps out, and starts over for the next system',
        async () => {
            const { sim, assets } = await coldClient();
            const schedule = manualScheduler();
            const slot = new ClientStateSlot();
            const debug = jasmine.createSpy('debug');
            const prefetch = new LandedUiPrefetch(sim, assets,
                { schedule, concurrency: 1, debug });
            prefetch.follow(slot);
            slot.apply(() => inSpace(thessaly));
            // Let the run get as far as its first PICTs, one at a time.
            for (let i = 0; i < 400 && assets.prefetched.length < 3; i++) {
                schedule.tick();
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            expect(assets.prefetched.length).toBeGreaterThan(0);
            const atJump = assets.prefetched.length;

            slot.apply(() => transitTo(SYNTHETIC.systems.kestrel));
            await schedule.flush();
            await prefetch.idle;
            expect(prefetch.done).toBe(false);
            // Not one PICT after the jump began; a cancelled run is not
            // a failure either.
            expect(assets.prefetched.length).toBe(atJump);
            expect(debug).not.toHaveBeenCalled();

            slot.apply(() => inSpace(SYNTHETIC.systems.kestrel));
            expect(prefetch.systemId).toBe(SYNTHETIC.systems.kestrel);
            await schedule.flush();
            await prefetch.idle;
            expect(prefetch.done).toBe(true);
        });

    it('warms nothing landing-related in a system with no landable stellar', async () => {
        // Vael Hollow holds only a hypergate and a wormhole.
        const { sim, meter, assets } = await coldClient();
        const slot = new ClientStateSlot();
        const prefetch = new LandedUiPrefetch(sim, assets, { schedule: immediately });
        prefetch.follow(slot);
        slot.apply(() => inSpace(SYNTHETIC.systems.vael));
        await prefetch.idle;
        expect(prefetch.done).toBe(true);
        expect(assets.prefetched).toEqual([]);
        expect(assets.stringTableLoads).toBe(0);
        // Only the sÿst and its spöbs were read to find that out.
        expect(meter.stats.ids).toBeLessThanOrEqual(3);
    });

    describe('the plan', () => {
        function planet(id: string, flags: Partial<PlanetData['flags']>,
            extra: Partial<PlanetData> = {}): PlanetData {
            const base = getDefaultPlanetData();
            return {
                ...base, id, landingPict: `${id}-landscape`,
                flags: {
                    ...base.flags, hasBar: false, hasOutfitter: false,
                    hasShipyard: false, hasCommodityExchange: false,
                    ...flags,
                },
                ...extra,
            };
        }

        it('scopes each venue\'s art to a system where some stellar has it', () => {
            const plan = planLandedUi([
                planet('a', { hasBar: true }, { barPict: 'nova:9100' }),
                planet('b', { hasCommodityExchange: true }),
            ]);
            expect(plan.venues).toEqual(
                { bar: true, outfitter: false, shipyard: false, trade: true });
            expect(plan.picts).toContain(BAR_PICT);
            expect(plan.picts).toContain('nova:9100');
            expect(plan.picts).toContain(TRADE_CENTER_PICT);
            expect(plan.picts).toContain('a-landscape');
            expect(plan.picts).toContain('b-landscape');
            expect(plan.picts).not.toContain(OUTFITTER_PICT);
            expect(plan.picts).not.toContain(SHIP_INFO_PICT);
        });

        it('ignores stellars that cannot be landed on, gates included', () => {
            const plan = planLandedUi([
                planet('rock', { canLand: false, hasBar: true }),
                planet('gate', { hasBar: true }, {
                    gate: { kind: 'hypergate', destinations: [] } as
                        unknown as PlanetData['gate'],
                }),
                undefined,
            ]);
            expect(plan.landable).toEqual([]);
            expect(plan.picts.size).toBe(0);
            expect(plan.stringTables.size).toBe(0);
        });
    });
});
