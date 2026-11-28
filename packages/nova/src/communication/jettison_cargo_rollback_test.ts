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
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { makeSystem } from '../nova_plugin/make_system.js';
import {
    ActiveMission, ControlledByComponent, Missions, MissionsComponent,
    PEER_LOCAL_COMPONENTS,
} from '../nova_plugin/player/index.js';
import {
    CargoComponent, CargoJettisonedEvent, makeShip,
} from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { RollbackRelay } from './rollback_relay.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

function mission(id: string, partial: Partial<ActiveMission>): ActiveMission {
    return {
        id, acceptedDay: 1, acceptedAt: 'nova:128', travelPlanet: null,
        returnPlanet: 'nova:128', cargoType: -1, cargoQty: 0,
        cargoLoaded: false, travelDone: false, deadlineDay: null,
        ...partial,
    };
}

/**
 * Jettison Cargo in flight (nova_plugin/ship/jettison_cargo.ts, reference
 * "Jettison cargo, wave 55") is the `jettisonCargo` input record: applied
 * to the sender's own ship on every peer at one tick, so a peer that
 * rolls back across it resimulates the same empty hold and failed
 * missions, a late joiner's wire-restored world carries them, and no peer
 * can empty another's hold.
 */
describe('jettisoning cargo in a room', () => {
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
            fail(`${what}: `
                + diffWorldHashes(hashA, hashB).slice(0, 10).join('; '));
        }
    }

    function hold(world: World, uuid: string) {
        return [...world.entities.get(uuid)!.components.get(CargoComponent)!];
    }

    function missions(world: World, uuid: string) {
        return world.entities.get(uuid)!.components.get(MissionsComponent)!;
    }

    it('empties the sender\'s hold and fails its cargo missions on every '
        + 'peer, across a rollback, and a late joiner restores it',
        async () => {
            const gameData = await getSyntheticGameData();
            const peerA = await makePeer('a');
            const peerB = await makePeer('b');

            const ship = async (uuid: string, peerId: string, x: number) => {
                const hull = makeShip(
                    await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
                hull.components.set(MovementStateComponent, {
                    accelerating: 0, position: new Position(x, 0),
                    rotation: new Angle(0), turnBack: false, turning: 0,
                    velocity: new Vector(0, 0),
                });
                hull.components.set(ControlledByComponent, { peerId });
                await completeEntity(peerA.world, hull);
                hull.components.set(CargoComponent, new Map([
                    ['cargo:0', 2], ['cargo:3', 1], ['mission:nova:251', 3],
                    ['mission:nova:630', 2],
                ]));
                const list: Missions = new Map([
                    // 3 t aboard: fails.
                    ['nova:251', mission('nova:251', {
                        cargoType: 2, cargoQty: 3, cargoLoaded: true,
                    })],
                    // 2 t aboard: fails.
                    ['nova:630', mission('nova:630', {
                        cargoType: 1, cargoQty: 2, cargoLoaded: true,
                    })],
                    // No cargo, and cargo not yet picked up: untouched.
                    ['nova:631', mission('nova:631', {})],
                    ['nova:632', mission('nova:632', {
                        cargoType: 4, cargoQty: 1, cargoLoaded: false,
                    })],
                ]);
                hull.components.set(MissionsComponent, list);
                return hull;
            };
            await peerA.client.addEntity('ship a',
                await ship('ship a', 'a', 0));
            await peerB.client.addEntity('ship b',
                await ship('ship b', 'b', 400));

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
            expect(hold(peerB.world, 'ship a').length).toBe(4);

            const jettisoned: string[][] = [];
            peerB.world.events.get(CargoJettisonedEvent)
                .subscribe(({ data, entities }) => jettisoned.push([
                    String(data.missionFailed),
                    ...(entities ?? []).map(String)]));

            // Peer B runs AHEAD of A, so the jettison lands in its past.
            for (let i = 0; i < 4; i++) {
                peerB.host.step();
            }
            const bLog = (peerB.host as unknown as {
                rollbackLog: { event: string }[],
            }).rollbackLog;
            const rollbacksBefore =
                bLog.filter(e => e.event === 'rollback').length;
            peerA.client.jettisonCargo();
            await step(4, [peerA]);
            await step(30);
            expect(bLog.filter(e => e.event === 'rollback').length)
                .withContext('peer B rolled back across the jettison')
                .toBeGreaterThan(rollbacksBefore);
            expect(jettisoned.some(([failed, uuid]) =>
                failed === 'true' && uuid === 'ship a'))
                .withContext('the event reached peer B').toBeTrue();

            while (frame(peerA.world) !== frame(peerB.world)) {
                (frame(peerA.world) < frame(peerB.world) ? peerA : peerB)
                    .host.step();
            }
            for (const peer of [peerA, peerB]) {
                expect(hold(peer.world, 'ship a')).toEqual([]);
                const list = missions(peer.world, 'ship a');
                for (const id of ['nova:251', 'nova:630']) {
                    expect(list.get(id)).withContext(id).toEqual(
                        jasmine.objectContaining({
                            failed: true, failCause: 'jettison',
                            cargoLoaded: false,
                        }));
                }
                for (const id of ['nova:631', 'nova:632']) {
                    expect(list.get(id)?.failed).withContext(id)
                        .toBeUndefined();
                }
                // B's own hold is untouched by A's jettison.
                expect(hold(peer.world, 'ship b').length).toBe(4);
            }
            expectSameWorld(peerA.world, peerB.world,
                'peer B after its rollback');

            // A second record with nothing aboard changes nothing.
            peerA.client.jettisonCargo();
            await step(10);
            expect(hold(peerA.world, 'ship b').length).toBe(4);

            // A late joiner rebuilds the room from a wire baseline.
            const peerC = await makePeer('c');
            expect(await peerC.host.joinRoom()).toBeTrue();
            while (frame(peerA.world) !== frame(peerC.world)) {
                (frame(peerA.world) < frame(peerC.world) ? peerA : peerC)
                    .host.step();
            }
            expect(hold(peerC.world, 'ship a')).toEqual([]);
            expect(missions(peerC.world, 'ship a').get('nova:251'))
                .toEqual(jasmine.objectContaining({
                    failed: true, failCause: 'jettison',
                }));
            expectSameWorld(peerA.world, peerC.world, 'the late joiner');
        }, 120_000);
});
