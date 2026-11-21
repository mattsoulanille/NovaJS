import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { CommunicatorResource, MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { makeSystem, SIMULATION_STEP_MS } from '../nova_plugin/make_system.js';
import { advanceSimulationDebt } from '../client/frame_pump.js';
import { ControlledByComponent, PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * End-to-end two-client room speed vote tests (#371):
 * - all clients switch pace at the exact same tick boundary (`atTick`)
 * - speed changes never enter the simulation input log or alter physics
 * - determinism holds bit-identically across 1x -> 2x -> 1x transitions
 *   between both clients and the server's RoomArchive.
 */
describe('Room speed vote integration (#371)', () => {
    let comms: Map<string, MockCommunicator>;
    let relay: RollbackRelay;

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
        relay = new RollbackRelay(comms.get('server')!, { autoClock: false });
    });

    afterEach(() => {
        relay.close();
    });

    async function makePeer(peerId: string, systemId?: string) {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        systemId ??= [...ids.System].sort()[0]!;
        const world = await makeSystem(systemId, gameData, 'worker', { npcs: false });
        world.resources.set(CommunicatorResource, comms.get(peerId)!);
        const host = new SimulationBridgeHost(world, gameData);
        const serializer = world.resources.get(SerializerResource)!;
        const client = new SimulationBridgeClient(host, serializer);
        return { world, host, client, systemId };
    }

    async function makePeerShip(peerId: string, world: World) {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const shipData = await gameData.data.Ship.get([...ids.Ship].sort()[0]!);
        const ship = makeShip(shipData);
        ship.components.set(ControlledByComponent, { peerId });
        ship.components.set(MultiplayerData, { owner: peerId });
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(peerId === 'a' ? 100 : -100, 50);
        movement.rotation = new Angle(1);
        movement.velocity = new Vector(0, 0);
        await completeEntity(world, ship);
        return ship;
    }

    it('switches pace at the exact same tick on both clients (1x -> 2x -> 1x)', async () => {
        const peerA = await makePeer('a');
        const peerB = await makePeer('b');

        expect(await peerA.host.joinRoom()).toBeTrue();
        expect(await peerB.host.joinRoom()).toBeTrue();

        // Advance both clients and the relay to tick 10 at 1x.
        // (joinRoom fast-forwards to Math.ceil(estimatedServerTick()), which
        // can be tick 1 after a few ms of wall time.)
        relay.stepClock(SIMULATION_STEP_MS * 10);
        peerA.host.step(relay.tick - peerA.host.status().tick);
        peerB.host.step(relay.tick - peerB.host.status().tick);
        expect(peerA.host.status().tick).toBe(10);
        expect(peerB.host.status().tick).toBe(10);
        expect(peerA.host.snapshot().pacing?.speed).toBe(1);
        expect(peerB.host.snapshot().pacing?.speed).toBe(1);

        // Peer A votes yes alone -> still 1x, waiting for 1 of 2.
        peerA.host.setSpeedVote(true, true);
        const snapAWaiting = peerA.host.snapshot();
        expect(snapAWaiting.pacing?.speed).toBe(1);
        expect(snapAWaiting.roomSpeed).toEqual({
            speed: 1, targetSpeed: 1, atTick: 0,
            fastVotes: 1, totalVoters: 2, wantFast: true, inSpace: true,
        });
        expect(peerB.host.snapshot().pacing?.speed).toBe(1);

        // Peer B votes yes -> unanimous! Scheduled at tick 11 (relay.tick + 1).
        peerB.host.setSpeedVote(true, true);
        const switchUpTick = relay.speedState.atTick;
        expect(switchUpTick).toBe(11);

        // At tick 10 (before the boundary): BOTH clients are still at 1x.
        expect(peerA.host.snapshot().pacing?.speed).toBe(1);
        expect(peerB.host.snapshot().pacing?.speed).toBe(1);

        // Cross the boundary to tick 11: BOTH clients switch to 2x on tick 11.
        relay.stepClock(SIMULATION_STEP_MS); // 10 -> 11 (activates 2x)
        peerA.host.step(1);
        peerB.host.step(1);
        expect(peerA.host.status().tick).toBe(switchUpTick);
        expect(peerB.host.status().tick).toBe(switchUpTick);

        const snapAFast = peerA.host.snapshot();
        const snapBFast = peerB.host.snapshot();
        expect(snapAFast.pacing?.speed).toBe(2);
        expect(snapBFast.pacing?.speed).toBe(2);
        expect(snapAFast.pacing!.rate).toBeGreaterThan(1.8);
        expect(snapBFast.pacing!.rate).toBeGreaterThan(1.8);
        expect(snapAFast.roomSpeed?.speed).toBe(2);
        expect(snapBFast.roomSpeed?.speed).toBe(2);

        // Advance 10 more steps at 2x (20 ticks -> tick 31).
        expect(relay.stepClock(SIMULATION_STEP_MS * 10)).toBe(20);
        peerA.host.step(20);
        peerB.host.step(20);
        expect(relay.tick).toBe(31);

        // Newcomer C joins without Caps Lock -> drops back to 1x at tick 32.
        const commC = new MockCommunicator('c');
        comms.set('c', commC);
        commC.mockPeers = comms;
        for (const comm of comms.values()) {
            comm.peers.current.next(new Set(comms.keys()));
        }
        const peerC = await makePeer('c');
        expect(await peerC.host.joinRoom()).toBeTrue();
        const switchDownTick = relay.speedState.atTick;
        expect(switchDownTick).toBe(32);

        // Still at tick 31 (before the boundary): BOTH clients still report 2x.
        expect(peerA.host.snapshot().pacing?.speed).toBe(2);
        expect(peerB.host.snapshot().pacing?.speed).toBe(2);

        // Cross to tick 32: BOTH clients switch back to 1x on the exact same tick.
        relay.stepClock(SIMULATION_STEP_MS); // 31 -> 32 (activates 1x)
        peerA.host.step(1);
        peerB.host.step(1);
        expect(peerA.host.status().tick).toBe(switchDownTick);
        expect(peerB.host.status().tick).toBe(switchDownTick);
        expect(peerA.host.snapshot().pacing?.speed).toBe(1);
        expect(peerB.host.snapshot().pacing?.speed).toBe(1);
        expect(peerA.host.snapshot().pacing!.rate).toBeLessThan(1.2);
        expect(peerB.host.snapshot().pacing!.rate).toBeLessThan(1.2);

        // Speed votes are non-simulation control messages: never logged as inputs.
        expect(relay.inputLog.length).toBe(0);
    });

    it('preserves bit-identical simulation determinism across a real pacing-driven 1x -> 2x -> 1x run', async () => {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const systemId = [...ids.System].sort()[0]!;

        const archive = new RoomArchive(relay,
            () => makeSystem(systemId, gameData, 'node', { npcs: false }),
            { autoUpdate: false });
        try {
            const peerA = await makePeer('a', systemId);
            const peerB = await makePeer('b', systemId);

            expect(await peerA.host.joinRoom()).toBeTrue();
            expect(await peerB.host.joinRoom()).toBeTrue();

            await peerA.client.addEntity('ship-a', await makePeerShip('a', peerA.world));
            await peerB.client.addEntity('ship-b', await makePeerShip('b', peerB.world));

            // Drive BOTH clients independently via advanceSimulationDebt using
            // ONLY their own snapshot().pacing (never cheating by reading
            // relay.tick). Slight frame stagger between A and B exercises real
            // rollback corrections across the 2x run.
            const pumpState = {
                a: { timeDebt: 0, pacing: peerA.host.snapshot().pacing },
                b: { timeDebt: 0, pacing: peerB.host.snapshot().pacing },
            };
            const driveFrame = async (elapsedMs: number, stepBFirst: boolean) => {
                relay.stepClock(elapsedMs);
                const order = stepBFirst
                    ? ([['b', peerB], ['a', peerA]] as const)
                    : ([['a', peerA], ['b', peerB]] as const);
                for (const [key, peer] of order) {
                    const st = pumpState[key];
                    const next = advanceSimulationDebt({
                        timeDebt: st.timeDebt,
                        elapsedMs,
                        paused: false,
                        pendingSteps: 0,
                        pacing: st.pacing,
                    });
                    st.timeDebt = next.timeDebt;
                    if (next.steps > 0) {
                        peer.host.step(next.steps);
                    }
                    st.pacing = peer.host.snapshot().pacing;
                }
                await new Promise(resolve => setImmediate(resolve));
            };

            // Phase 1: 30 frames at 1x (~30 ticks on each client via pacing).
            const tickA0 = peerA.host.status().tick;
            for (let f = 0; f < 30; f++) {
                if (f === 5) {
                    peerA.host.controlEvents([{ action: 'accelerate', state: 'start' }]);
                }
                if (f === 15) {
                    peerB.host.controlEvents([
                        { action: 'turnLeft', state: 'start' },
                        { action: 'firePrimary', state: 'start' },
                    ]);
                }
                await driveFrame(SIMULATION_STEP_MS, f % 2 === 1);
            }
            const ticksPhase1A = peerA.host.status().tick - tickA0;
            expect(ticksPhase1A).toBeGreaterThanOrEqual(25);
            expect(ticksPhase1A).toBeLessThanOrEqual(40);
            expect(relay.speed).toBe(1);

            // Switch unanimously to 2x.
            peerA.host.setSpeedVote(true, true);
            peerB.host.setSpeedVote(true, true);

            // Phase 2: 60 frames at 2x (~120 ticks on each client driven purely
            // by their own 2x pacing — fails if 2x pacing is stubbed out!).
            const tickA1 = peerA.host.status().tick;
            const tickB1 = peerB.host.status().tick;
            for (let f = 0; f < 60; f++) {
                if (f === 10) {
                    peerA.host.controlEvents([{ action: 'firePrimary', state: 'start' }]);
                }
                if (f === 25) {
                    peerB.host.controlEvents([{ action: 'turnLeft', state: false }]);
                    peerB.host.controlEvents([{ action: 'accelerate', state: 'start' }]);
                }
                await driveFrame(SIMULATION_STEP_MS, f % 3 === 0);
            }
            const ticksPhase2A = peerA.host.status().tick - tickA1;
            const ticksPhase2B = peerB.host.status().tick - tickB1;
            expect(relay.speed).toBe(2);
            expect(ticksPhase2A).toBeGreaterThanOrEqual(105);
            expect(ticksPhase2B).toBeGreaterThanOrEqual(105);
            expect(pumpState.a.pacing?.speed).toBe(2);
            expect(pumpState.b.pacing?.speed).toBe(2);

            // Drop back to 1x mid-flight.
            peerB.host.setSpeedVote(false, true);

            // Phase 3: 30 frames at 1x (~30 ticks on each client).
            const tickA2 = peerA.host.status().tick;
            for (let f = 0; f < 30; f++) {
                if (f === 10) {
                    peerA.host.controlEvents([{ action: 'accelerate', state: false }]);
                }
                await driveFrame(SIMULATION_STEP_MS, f % 2 === 0);
            }
            const ticksPhase3A = peerA.host.status().tick - tickA2;
            expect(relay.speed).toBe(1);
            expect(ticksPhase3A).toBeGreaterThanOrEqual(25);
            expect(ticksPhase3A).toBeLessThanOrEqual(45);
            expect(pumpState.a.pacing?.speed).toBe(1);
            expect(pumpState.b.pacing?.speed).toBe(1);

            // Park A, B, and the archive on the same tick past all inputs.
            const parkTick = Math.max(
                relay.tick, peerA.host.status().tick, peerB.host.status().tick) + 20;
            relay.advanceTicks(parkTick - relay.tick);
            peerA.host.step(parkTick - peerA.host.status().tick);
            peerB.host.step(parkTick - peerB.host.status().tick);
            await new Promise(resolve => setImmediate(resolve));
            peerA.host.step(0);
            peerB.host.step(0);
            await archive.update();

            expect(peerA.host.status().tick).toBe(parkTick);
            expect(peerB.host.status().tick).toBe(parkTick);
            expect(archive.tick).toBe(parkTick);

            const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS).hash;
            const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS).hash;
            const hashArchive = hashWorld(archive.archiveWorld!, PEER_LOCAL_COMPONENTS).hash;
            expect(hashA).toBe(hashB);
            expect(hashA).toBe(hashArchive);
            expect(peerA.host.desyncCount).toBe(0);
            expect(peerB.host.desyncCount).toBe(0);
        } finally {
            archive.close();
        }
    }, 30000);
});
