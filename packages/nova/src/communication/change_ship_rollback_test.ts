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
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    ControlledByComponent, CreditsComponent, GameDateComponent, MissionsComponent,
    PEER_LOCAL_COMPONENTS,
} from '../nova_plugin/player/index.js';
import { CargoComponent, makeShip, ShipComponent } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import {
    buildShipMissionOffer, buildShipMissionRefusal,
} from '../spaceport/ship_mission_accept.js';
import { RollbackRelay } from './rollback_relay.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * ============================================================================
 * An in-flight change of ship, across a room (#141, part 2)
 * ============================================================================
 *
 * A refused ship-offered mission's OnRefuse `Hxxx` (the synthetic Muster
 * Call, rewritten to stay in the system) reaches the simulation as a
 * `refuseMission` input record. Here it crosses a real relay to a second
 * peer that has already simulated PAST the record's tick — so that peer
 * rolls back and resimulates through the swap — and then a third peer joins
 * late and rebuilds the world from the log. All three must agree, hash for
 * hash, and all three must have the pilot in the new hull at their uuid.
 */
describe('an in-flight change of ship in a room', () => {
    const PEER = 'a';
    const WARDEN = SYNTHETIC.ships.warden;
    const REPORT = SYNTHETIC.missions.musterReport;
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
        ship.components.set(MissionsComponent, new Map());
        ship.components.set(ControlBitsComponent, new Set<number>([BITS.musterOffered]));
        ship.components.set(ActiveRanksComponent, new Set());
        ship.components.set(CargoComponent, new Map());
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
        expect(peerB.world.entities.has('ship a')).toBeTrue();

        // The refusal, resolved against peer A's own view of its ship.
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const pilot = peerA.world.entities.get('ship a')!;
        const pers = await gameData.data.Pers.get(SYNTHETIC.persons.muster);
        const offer = await buildShipMissionOffer(pilot, pers, 'hail', gameData,
            universe, { systemId: SYNTHETIC.systems.thessaly, random: () => 0 });
        expect(offer).not.toBeNull();
        const refusal = await buildShipMissionRefusal(pilot, {
            ...offer!, data: {
                ...offer!.data,
                onRefuse: `!b${BITS.musterOffered} H130 s138 b${BITS.musterJoined}`,
            },
        }, gameData, universe, { systemId: SYNTHETIC.systems.thessaly });
        expect(refusal!.record.shipChange).toEqual({ shipId: WARDEN });

        // Peer B runs AHEAD of A, so A's record lands in B's past.
        for (let i = 0; i < 4; i++) {
            peerB.host.step();
        }
        const bLog = (peerB.host as unknown as {
            rollbackLog: { event: string, detail?: { toTick?: number } }[],
        }).rollbackLog;
        const rollbacksBefore = bLog.filter(e => e.event === 'rollback').length;
        await peerA.client.refuseMission(refusal!.record);
        // A catches up to B, delivering the record on the way.
        await step(4, [peerA]);
        await step(30);
        expect(bLog.filter(e => e.event === 'rollback').length)
            .withContext('peer B rolled back across the record')
            .toBeGreaterThan(rollbacksBefore);

        while (frame(peerA.world) !== frame(peerB.world)) {
            (frame(peerA.world) < frame(peerB.world) ? peerA : peerB).host.step();
        }
        for (const peer of [peerA, peerB]) {
            const hull = peer.world.entities.get('ship a')!;
            expect(hull.components.get(ShipComponent)?.id).toBe(WARDEN);
            expect(hull.components.get(MissionsComponent)?.has(REPORT)).toBeTrue();
            expect(hull.components.get(ControlledByComponent)).toEqual({ peerId: PEER });
        }
        expectSameWorld(peerA.world, peerB.world, 'peer B after its rollback');

        // A late joiner rebuilds the room from the log.
        const peerC = await makePeer('c');
        expect(await peerC.host.joinRoom()).toBeTrue();
        while (frame(peerA.world) !== frame(peerC.world)) {
            (frame(peerA.world) < frame(peerC.world) ? peerA : peerC).host.step();
        }
        expect(peerC.world.entities.get('ship a')!.components.get(ShipComponent)?.id)
            .toBe(WARDEN);
        expectSameWorld(peerA.world, peerC.world, 'the late joiner');
    }, 120_000);
});
