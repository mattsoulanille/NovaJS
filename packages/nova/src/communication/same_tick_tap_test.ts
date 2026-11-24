import 'jasmine';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { ActiveSecondaryWeapon } from '../nova_plugin/combat/index.js';
import { ControlAction, ControlEvent, ProjectileComponent } from '../nova_plugin/core/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import {
    ControlledByComponent, ShipControlEvent, ShipControlStateComponent,
    ShipControlTickComponent,
} from '../nova_plugin/player/index.js';
import { makeShip, SourceComponent } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/index.js';
import { RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';
import { applyInputRecords, InputRecord } from './simulation_input.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * A tap that collapses onto one tick (#377). The relay retimes a
 * lagging sender's late records to `max(stamp, relayTick + 1)`, so a
 * press record and its release record, stamped on consecutive ticks,
 * can land on the SAME tick, on every world. Before the fix the release
 * applied right after the press, before the step: the trigger was never
 * down for a step and the shot (the missile) was lost. The ruling
 * (option 1, sim side): a release that lands on its press's tick is held
 * until the end of the step, so the tap fires exactly once.
 */

const press = (action: ControlAction): ControlEvent =>
    ({ action, state: 'start' });
const release = (action: ControlAction): ControlEvent =>
    ({ action, state: false });
const control = (...events: ControlEvent[]) =>
    ({ kind: 'control' as const, events });

/** The projectiles `shooter` fired that are alive in `world` now. */
function projectilesOf(world: World, shooter: string) {
    return [...world.entities]
        .filter(([, entity]) => entity.components.has(ProjectileComponent)
            && entity.components.get(SourceComponent) === shooter)
        .map(([uuid]) => uuid);
}

async function makeShooter(world: World, peerId: string, x: number) {
    const gameData = await getSyntheticGameData();
    // Twin blasters (primary) and a missile rack (secondary, 8 rounds).
    const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.corsair);
    const ship = makeShip(shipData);
    ship.components.set(ControlledByComponent, { peerId });
    const movement = ship.components.get(MovementStateComponent)!;
    movement.position = new Position(x, 0);
    movement.rotation = new Angle(0);
    movement.velocity = new Vector(0, 0);
    await completeEntity(world, ship);
    return ship;
}

describe('a tap whose press and release land on one tick (#377)', () => {
    describe('applied directly (one world, two records on one tick)', () => {
        let world: World;
        let seq: number;
        let tick: number;
        let shotsSeen: Set<string>;

        beforeEach(async () => {
            const gameData = await getSyntheticGameData();
            world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
                'node', { npcs: false });
            world.entities.set('ship a', await makeShooter(world, 'a', 0));
            seq = 0;
            tick = 0;
            shotsSeen = new Set();
            // Warm up: the weapons state derives and the weapons of a
            // ship that just arrived finish their first reload (the
            // missile's is 60 frames = 120 ticks).
            quiet(150);
        });

        function run(...records: ControlEvent[][]) {
            tick++;
            applyInputRecords(world, records.map(events => ({
                tick, peerId: 'a', seq: ++seq, inputs: [control(...events)],
            } satisfies InputRecord)));
            world.step();
            for (const uuid of projectilesOf(world, 'ship a')) {
                shotsSeen.add(uuid);
            }
        }

        function quiet(ticks: number) {
            for (let i = 0; i < ticks; i++) {
                run();
            }
        }

        /** Shots from one tap: on consecutive ticks, or on one tick. */
        function tapShots(action: ControlAction, collapsed: boolean) {
            const before = shotsSeen.size;
            if (collapsed) {
                run([press(action)], [release(action)]);
            } else {
                run([press(action)]);
                run([release(action)]);
            }
            // Past the missile's reload (60 frames = 120 ticks).
            quiet(150);
            return shotsSeen.size - before;
        }

        it('fires the primary exactly as a tap spread over two ticks does', () => {
            const clean = tapShots('firePrimary', false);
            expect(clean).toBeGreaterThan(0);
            expect(tapShots('firePrimary', true)).toBe(clean);
            // And the trigger is up again: nothing more fires.
            const after = shotsSeen.size;
            quiet(60);
            expect(shotsSeen.size).toBe(after);
        });

        it('fires the selected secondary (the missile) exactly once', () => {
            run([press('nextSecondary')]);
            run([release('nextSecondary')]);
            expect(world.entities.get('ship a')!
                .components.get(ActiveSecondaryWeapon)?.secondary)
                .toBe(SYNTHETIC.weapons.missile);
            expect(tapShots('fireSecondary', false)).toBe(1);
            expect(tapShots('fireSecondary', true)).toBe(1);
        });

        it('runs the edge handlers once with the press, then once more with the release', () => {
            const runs: [string, unknown][] = [];
            world.addSystem(new System({
                name: 'SameTickEdgeProbe',
                events: [ShipControlEvent],
                args: [ShipControlStateComponent] as const,
                step(state) {
                    runs.push(['edge', state.get('nextTarget')]);
                },
            }));
            run([press('nextTarget')], [release('nextTarget')]);
            // The press's edge, seen once; then the held release.
            expect(runs).toEqual([['edge', 'start'], ['edge', false]]);
            runs.length = 0;
            quiet(2);
            expect(runs).toEqual([]);
        });

        it('keeps two presses on one tick as two edges, not one decayed by the other', () => {
            const seen: string[][] = [];
            world.addSystem(new System({
                name: 'SameTickPressesProbe',
                events: [ShipControlEvent],
                args: [ShipControlStateComponent] as const,
                step(state) {
                    seen.push([...state].filter(([, v]) => v === 'start')
                        .map(([action]) => action).sort());
                },
            }));
            run([press('accelerate')], [press('turnLeft')]);
            expect(seen).toEqual([['accelerate', 'turnLeft']]);
        });

        it('leaves no bookkeeping behind after the step', () => {
            run([press('firePrimary')], [release('firePrimary')]);
            const ship = world.entities.get('ship a')!;
            expect(ship.components.has(ShipControlTickComponent)).toBeFalse();
            expect(world.queuedEventCount).toBe(0);
            expect(ship.components.get(ShipControlStateComponent)!
                .get('firePrimary')).toBe(false);
        });
    });

    describe('through a real relay, from a lagging sender', () => {
        let comms: Map<string, MockCommunicator>;
        let relay: RollbackRelay;
        let archive: RoomArchive;

        beforeEach(() => {
            comms = new Map([
                ['server', new MockCommunicator('server')],
                ['a', new MockCommunicator('a')],
                ['b', new MockCommunicator('b')],
            ]);
            for (const comm of comms.values()) {
                comm.mockPeers = comms;
                comm.peers.current.next(new Set(comms.keys()));
            }
            relay = new RollbackRelay(comms.get('server')!, {
                autoClock: false,
                baseline: () => archive?.latest,
            });
            archive = new RoomArchive(relay, async () => makeSystem(
                SYNTHETIC.systems.thessaly, await getSyntheticGameData(),
                'node', { npcs: false }),
            { intervalTicks: 30, autoUpdate: false });
        });

        afterEach(() => {
            relay.close();
        });

        async function makePeer(peerId: string) {
            const gameData = await getSyntheticGameData();
            const world = await makeSystem(SYNTHETIC.systems.thessaly,
                gameData, 'worker', { npcs: false });
            world.resources.set(CommunicatorResource, comms.get(peerId)!);
            const host = new SimulationBridgeHost(world, gameData);
            const client = new SimulationBridgeClient(host,
                world.resources.get(SerializerResource)!);
            return { world, host, client };
        }

        it('fires every tap exactly once on every world, primary and secondary', async () => {
            const peerA = await makePeer('a');
            const peerB = await makePeer('b');
            await peerA.client.addEntity('ship a',
                await makeShooter(peerA.world, 'a', 0));
            await peerB.client.addEntity('ship b',
                await makeShooter(peerB.world, 'b', 0));

            // A's link to the server: while `lagging`, everything A
            // sends waits, and goes out late in one burst.
            const linkA = comms.get('a')!;
            const send = linkA.sendMessage.bind(linkA);
            let lagging = false;
            const delayed: Parameters<typeof send>[] = [];
            spyOn(linkA, 'sendMessage').and.callFake((...args) => {
                if (lagging) {
                    delayed.push(args);
                } else {
                    send(...args);
                }
            });

            const worlds = () => ({
                a: peerA.world, b: peerB.world,
                archive: archive.archiveWorld!,
            });
            const shots = { a: new Set<string>(), b: new Set<string>(),
                archive: new Set<string>() };
            const step = async (ticks = 1) => {
                for (let i = 0; i < ticks; i++) {
                    peerA.host.step();
                    peerB.host.step();
                    relay.advanceTicks(1);
                    await archive.update();
                    await new Promise(resolve => setImmediate(resolve));
                    for (const [name, world] of Object.entries(worlds())) {
                        for (const uuid of projectilesOf(world, 'ship a')) {
                            shots[name as keyof typeof shots].add(uuid);
                        }
                    }
                }
            };
            const counts = () => [shots.a.size, shots.b.size,
                shots.archive.size];

            /**
             * One tap by A: the shots it put on a, b and the archive,
             * and the ticks its press and release took in the room's
             * log.
             */
            const tap = async (action: ControlAction, lag: boolean) => {
                const before = counts();
                const since = relay.tick;
                lagging = lag;
                peerA.host.controlEvents([press(action)]);
                await step();
                peerA.host.controlEvents([release(action)]);
                await step();
                if (lag) {
                    // The relay runs on past both records' stamps...
                    await step(4);
                    lagging = false;
                    // ...and then they arrive together.
                    for (const args of delayed.splice(0)) {
                        send(...args);
                    }
                }
                await step(2);
                // Read before the archive's baselines trim the log.
                const ticks = relay.inputLog
                    .filter(record => record.peerId === 'a'
                        && record.tick > since
                        && record.inputs.some(input => input.kind === 'control'
                            && input.events.some(event => event.action === action)))
                    .map(record => record.tick);
                // Past the missile's reload (60 frames = 120 ticks).
                await step(150);
                return {
                    shots: counts().map((count, i) => count - before[i]!),
                    ticks,
                };
            };

            // Past the arriving ships' first reload.
            await step(150);
            peerA.host.controlEvents([press('nextSecondary')]);
            await step();
            peerA.host.controlEvents([release('nextSecondary')]);
            await step(5);
            for (const world of Object.values(worlds())) {
                expect(world.entities.get('ship a')!
                    .components.get(ActiveSecondaryWeapon)?.secondary)
                    .toBe(SYNTHETIC.weapons.missile);
            }

            const cleanPrimary = await tap('firePrimary', false);
            expect(cleanPrimary.shots[0]).toBeGreaterThan(0);
            expect(cleanPrimary.shots)
                .toEqual(Array(3).fill(cleanPrimary.shots[0]));
            // Unlagged, the release is on the tick after the press.
            expect(cleanPrimary.ticks[1]).toBe(cleanPrimary.ticks[0]! + 1);

            const laggedPrimary = await tap('firePrimary', true);
            // The lag really collapsed the tap: press and release share
            // a tick in the room's log.
            expect(laggedPrimary.ticks.length).toBe(2);
            expect(laggedPrimary.ticks[1]).toBe(laggedPrimary.ticks[0]!);
            expect(laggedPrimary.shots)
                .withContext('a lagged primary tap: shots on a, b, archive')
                .toEqual(cleanPrimary.shots);

            expect((await tap('fireSecondary', false)).shots)
                .toEqual([1, 1, 1]);
            const laggedSecondary = await tap('fireSecondary', true);
            expect(laggedSecondary.ticks.length).toBe(2);
            expect(laggedSecondary.ticks[1]).toBe(laggedSecondary.ticks[0]!);
            expect(laggedSecondary.shots)
                .withContext('a lagged missile tap: missiles on a, b, archive')
                .toEqual([1, 1, 1]);

            // And the three worlds agree on everything.
            const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS).hash;
            expect(hashWorld(peerB.world, PEER_LOCAL_COMPONENTS).hash)
                .toBe(hashA);
            expect(hashWorld(archive.archiveWorld!, PEER_LOCAL_COMPONENTS)
                .hash).toBe(hashA);
        }, 120_000);
    });
});
