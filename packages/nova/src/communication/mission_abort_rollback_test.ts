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
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import { makeSystem } from '../nova_plugin/make_system.js';
import { missionCargoKey } from '../nova_plugin/missions/index.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    ControlledByComponent, CreditsComponent, GameDateComponent, MissionsComponent,
    PEER_LOCAL_COMPONENTS,
} from '../nova_plugin/player/index.js';
import { CargoComponent, makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { buildMissionAbort } from '../spaceport/ship_mission_accept.js';
import { RollbackRelay } from './rollback_relay.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * ============================================================================
 * An in-flight mission abort, across a room
 * ============================================================================
 *
 * Peer A aborts its courier run from the in-flight 'i' dialog: an
 * `abortMission` input record. It crosses a real relay to peer B, which has
 * already simulated PAST the record's tick — so B rolls back and resimulates
 * through the abort — and then peer C joins late and rebuilds the world from
 * the log. All three must agree, hash for hash, and all three must see A's
 * mission, its OnAbort bit and its cargo gone.
 */
describe('an in-flight mission abort in a room', () => {
    const PEER = 'a';
    const COURIER = SYNTHETIC.missions.courier;
    const CARGO = missionCargoKey(COURIER);
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

    function expectAborted(world: World, who: string) {
        const ship = world.entities.get('ship a')!;
        expect(ship.components.get(MissionsComponent)?.has(COURIER))
            .withContext(`${who}: the mission`).toBeFalse();
        expect(ship.components.get(ControlBitsComponent)?.has(BITS.courierAccepted))
            .withContext(`${who}: OnAbort`).toBeFalse();
        expect([...ship.components.get(CargoComponent) ?? []])
            .withContext(`${who}: the cargo`).toEqual([['cargo:0', 6]]);
    }

    it('is applied identically after a rollback resimulation, and a late '
        + 'joiner\'s restored world matches', async () => {
        const gameData = await getSyntheticGameData();
        const peerA = await makePeer('a');
        const peerB = await makePeer('b');

        const ship = makeShip(await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(200, 80),
            rotation: new Angle(0.75), turnBack: false, turning: 0,
            velocity: new Vector(30, 10),
        });
        ship.components.set(ControlledByComponent, { peerId: PEER });
        ship.components.set(CreditsComponent, { credits: 9_000 });
        ship.components.set(GameDateComponent, { day: 1, month: 1, year: 1177 });
        ship.components.set(MissionsComponent, new Map([[COURIER, {
            id: COURIER, acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: SYNTHETIC.planets.moon,
            returnPlanet: SYNTHETIC.planets.port,
            cargoType: 0, cargoQty: 10, cargoLoaded: true, travelDone: false,
            deadlineDay: 30,
        }]]));
        ship.components.set(ControlBitsComponent, new Set<number>([BITS.courierAccepted]));
        ship.components.set(ActiveRanksComponent, new Set());
        ship.components.set(CargoComponent, new Map([[CARGO, 10], ['cargo:0', 6]]));
        await completeEntity(peerA.world, ship);
        await peerA.client.addEntity('ship a', ship);

        const step = async (ticks: number, peers = [peerA, peerB]) => {
            for (let i = 0; i < ticks; i++) {
                for (const peer of peers) {
                    peer.host.step();
                }
                relay.advanceTicks(1);
                await settle();
            }
        };
        await step(20);
        expect(peerB.world.entities.get('ship a')?.components
            .get(MissionsComponent)?.has(COURIER)).toBeTrue();

        // The abort, resolved against peer A's own view of its ship.
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const pilot = peerA.world.entities.get('ship a')!;
        const abort = await buildMissionAbort(pilot, COURIER, gameData,
            universe, { systemId: SYNTHETIC.systems.thessaly });
        expect(abort).not.toBeNull();

        // Peer B runs AHEAD of A, so A's record lands in B's past.
        for (let i = 0; i < 4; i++) {
            peerB.host.step();
        }
        const bLog = (peerB.host as unknown as {
            rollbackLog: { event: string }[],
        }).rollbackLog;
        const rollbacksBefore = bLog.filter(e => e.event === 'rollback').length;
        await peerA.client.abortMission(abort!.record);
        // A catches up to B, delivering the record on the way.
        await step(4, [peerA]);
        await step(30);
        expect(bLog.filter(e => e.event === 'rollback').length)
            .withContext('peer B rolled back across the record')
            .toBeGreaterThan(rollbacksBefore);

        while (frame(peerA.world) !== frame(peerB.world)) {
            (frame(peerA.world) < frame(peerB.world) ? peerA : peerB).host.step();
        }
        expectAborted(peerA.world, 'peer A');
        expectAborted(peerB.world, 'peer B');
        expectSameWorld(peerA.world, peerB.world, 'peer B after its rollback');

        // A late joiner rebuilds the room from the log.
        const peerC = await makePeer('c');
        expect(await peerC.host.joinRoom()).toBeTrue();
        while (frame(peerA.world) !== frame(peerC.world)) {
            (frame(peerA.world) < frame(peerC.world) ? peerA : peerC).host.step();
        }
        expectAborted(peerC.world, 'the late joiner');
        expectSameWorld(peerA.world, peerC.world, 'the late joiner');
    }, 120_000);
});
