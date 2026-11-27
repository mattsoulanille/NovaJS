import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { diffWorldHashes, hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { MissionData } from 'novadatainterface/mission_data';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import { makeSystem } from '../nova_plugin/make_system.js';
import {
    missionCargoKey, owedMissionSetString,
} from '../nova_plugin/missions/index.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    ActiveMission, ControlledByComponent, CreditsComponent, GameDateComponent,
    GOAL_DISABLE, MissionsComponent, PEER_LOCAL_COMPONENTS,
    PendingMissionNoticesComponent,
} from '../nova_plugin/player/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import { CargoComponent, makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { buildMissionSetString } from '../spaceport/ship_mission_accept.js';
import { RollbackRelay } from './rollback_relay.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * ============================================================================
 * A mission's OnShipDone, then its in-flight OnFailure, across a room
 * ============================================================================
 *
 * Peer A flies the courier run on a disable goal that the sim has
 * completed (its OnShipDone owed) and then failed (the disabled ship was
 * destroyed). A's client pays both, in that order, with `missionSetString`
 * records resolved against its own view (buildMissionSetString). They
 * cross a real relay to peer B, which has simulated PAST each record's
 * tick — so B rolls back and resimulates through it — and peer C joins
 * late and rebuilds the world from the log. All three agree hash for
 * hash, and the strings land on A's ship and on no one else's.
 */
describe('a mission\'s OnShipDone and in-flight OnFailure in a room', () => {
    const COURIER = SYNTHETIC.missions.courier;
    const SHIP_DONE_BIT = 9001;
    const FAILURE_BIT = 9002;
    let comms: Map<string, MockCommunicator>;
    let relay: RollbackRelay;

    beforeEach(() => {
        comms = new Map([
            ['server', new MockCommunicator('server')],
            ['a', new MockCommunicator('a')],
            ['b', new MockCommunicator('b')],
            ['c', new MockCommunicator('c')],
        ]);
        for (const comm of comms.values()) {
            comm.mockPeers = comms;
            comm.peers.current.next(new Set(comms.keys()));
        }
        relay = new RollbackRelay(comms.get('server')!, { autoClock: false });
        const original = MissionUniverse.prototype.getMission;
        spyOn(MissionUniverse.prototype, 'getMission').and.callFake(
            function (this: MissionUniverse, id: string) {
                const mission = original.call(this, id);
                return mission && id === COURIER ? {
                    ...mission,
                    onShipDone: `b${SHIP_DONE_BIT}`,
                    onFailure: `${mission.onFailure} b${FAILURE_BIT}`,
                } as MissionData : mission;
            });
    });
    afterEach(() => relay.close());

    async function makePeer(peerId: string) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        world.resources.set(CommunicatorResource, comms.get(peerId)!);
        const host = new SimulationBridgeHost(world, gameData);
        const client = new SimulationBridgeClient(host,
            world.resources.get(SerializerResource)!);
        return { world, host, client };
    }

    function frame(world: World) {
        return world.resources.get(TimeResource)!.frame;
    }

    async function settle() {
        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    function expectSameWorld(a: World, b: World, what: string) {
        const hashA = hashWorld(a, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(b, PEER_LOCAL_COMPONENTS);
        if (hashA.hash !== hashB.hash) {
            fail(`${what}: ` + diffWorldHashes(hashA, hashB).slice(0, 10).join('; '));
        }
    }

    function expectPaid(world: World, who: string) {
        const a = world.entities.get('ship a')!;
        const b = world.entities.get('ship b')!;
        const bitsA = a.components.get(ControlBitsComponent)!;
        expect(bitsA.has(SHIP_DONE_BIT)).withContext(`${who}: A's OnShipDone`)
            .toBeTrue();
        expect(bitsA.has(FAILURE_BIT)).withContext(`${who}: A's OnFailure`)
            .toBeTrue();
        expect(bitsA.has(BITS.courierAccepted))
            .withContext(`${who}: OnFailure's !b100`).toBeFalse();
        expect(a.components.get(MissionsComponent)!.has(COURIER))
            .withContext(`${who}: A's run failed`).toBeFalse();
        expect(a.components.get(PendingMissionNoticesComponent)
            ?.map(notice => notice.type))
            .withContext(`${who}: the notice waits for the spaceport`)
            .toEqual(['failed']);
        expect(b.components.get(ControlBitsComponent)!.has(SHIP_DONE_BIT))
            .withContext(`${who}: not B's`).toBeFalse();
        expect(b.components.get(MissionsComponent)!.has(COURIER))
            .withContext(`${who}: B's run`).toBeTrue();
    }

    function courier(): ActiveMission {
        return {
            id: COURIER, acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: SYNTHETIC.planets.moon,
            returnPlanet: SYNTHETIC.planets.port,
            cargoType: 0, cargoQty: 10, cargoLoaded: true, travelDone: false,
            deadlineDay: null,
            // Disabled (done), then destroyed (failed): mission_ship_state
            // shipDisabled, then shipDied.
            shipObjective: {
                goal: GOAL_DISABLE, systemId: null, shipStart: 0,
                behavior: -1, dudeId: SYNTHETIC.dudes.raiders, total: 1,
                satisfied: 0, complete: true, failed: true,
                shipDonePending: true, live: new Map(),
            },
        };
    }

    async function pilot(peerId: string, x: number) {
        const gameData = await getSyntheticGameData();
        const ship = makeShip(await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(x, 80),
            rotation: new Angle(0.75), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        ship.components.set(ControlledByComponent, { peerId });
        ship.components.set(CreditsComponent, { credits: 9_000 });
        ship.components.set(GameDateComponent, { day: 1, month: 1, year: 1177 });
        ship.components.set(LegalRecordsComponent, new Map());
        ship.components.set(ControlBitsComponent,
            new Set<number>([BITS.courierAccepted]));
        ship.components.set(ActiveRanksComponent, new Set());
        ship.components.set(MissionsComponent,
            new Map([[COURIER, courier()]]));
        ship.components.set(CargoComponent,
            new Map([[missionCargoKey(COURIER), 10]]));
        return ship;
    }

    it('is applied identically after a rollback resimulation, on the '
        + 'owner only, OnShipDone first, and a late joiner\'s restored world '
        + 'matches', async () => {
            const gameData = await getSyntheticGameData();
            const universe = MissionUniverse.shared(gameData);
            const peerA = await makePeer('a');
            const peerB = await makePeer('b');
            const shipA = await pilot('a', 200);
            await completeEntity(peerA.world, shipA);
            await peerA.client.addEntity('ship a', shipA);
            const shipB = await pilot('b', -200);
            await completeEntity(peerB.world, shipB);
            await peerB.client.addEntity('ship b', shipB);

            const step = async (ticks: number, peers = [peerA, peerB]) => {
                for (let i = 0; i < ticks; i++) {
                    for (const peer of peers) {
                        peer.host.step();
                    }
                    relay.advanceTicks(1);
                    await settle();
                }
            };
            const bLog = (peerB.host as unknown as {
                rollbackLog: { event: string }[],
            }).rollbackLog;
            const rollbacks = () =>
                bLog.filter(e => e.event === 'rollback').length;
            /** Peer A pays what it owes next, with B running ahead. */
            const pay = async (kind: 'shipDone' | 'failure') => {
                await step(10);
                const viewA = peerA.world.entities.get('ship a')!;
                const owed = owedMissionSetString(
                    viewA.components.get(MissionsComponent)!);
                expect(owed).toEqual({ kind, missionId: COURIER });
                const record = await buildMissionSetString(viewA, owed!,
                    gameData, universe,
                    { systemId: SYNTHETIC.systems.thessaly });
                expect(record).not.toBeNull();
                for (let i = 0; i < 4; i++) {
                    peerB.host.step();
                }
                const before = rollbacks();
                await peerA.client.missionSetString(record!);
                await step(4, [peerA]);
                await step(30);
                expect(rollbacks())
                    .withContext(`peer B rolled back across the ${kind}`)
                    .toBeGreaterThan(before);
                return record!;
            };

            await step(20);
            const shipDone = await pay('shipDone');
            expect(shipDone).toEqual({
                missionId: COURIER, kind: 'shipDone',
                bitsSet: [SHIP_DONE_BIT],
            });
            const failure = await pay('failure');
            expect(failure.kind).toBe('failure');
            expect(failure.bitsSet).toEqual([FAILURE_BIT]);

            while (frame(peerA.world) !== frame(peerB.world)) {
                (frame(peerA.world) < frame(peerB.world) ? peerA : peerB).host.step();
            }
            expectPaid(peerA.world, 'peer A');
            expectPaid(peerB.world, 'peer B');
            expectSameWorld(peerA.world, peerB.world, 'peer B after its rollbacks');

            const peerC = await makePeer('c');
            expect(await peerC.host.joinRoom()).toBeTrue();
            while (frame(peerA.world) !== frame(peerC.world)) {
                (frame(peerA.world) < frame(peerC.world) ? peerA : peerC).host.step();
            }
            expectPaid(peerC.world, 'the late joiner');
            expectSameWorld(peerA.world, peerC.world, 'the late joiner');
        }, 120_000);
});
