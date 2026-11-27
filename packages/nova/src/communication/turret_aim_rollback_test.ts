import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { diffWorldHashes, hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { ProjectileComponent } from '../nova_plugin/core/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import {
    ControlledByComponent, PEER_LOCAL_COMPONENTS, TurretAimComponent,
} from '../nova_plugin/player/index.js';
import { makeShip, SourceComponent } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { RollbackRelay } from './rollback_relay.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * The player's turret aim (nova_plugin/player/turret_aim.ts, Matthew's
 * ruling on reference T, wave 50) is per-player SIM state: it rides the
 * insertion record and a `setTurretAim` input record, so a peer that rolls
 * back across the flip resimulates the same shots, and a late joiner's
 * wire-restored world carries it.
 */
describe('the player\'s turret aim in a room', () => {
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

    function aim(world: World) {
        return world.entities.get('ship a')!.components
            .get(TurretAimComponent);
    }

    function shotsOf(world: World) {
        return [...world.entities.values()].filter((e: Entity) =>
            e.components.has(ProjectileComponent)
            && e.components.get(SourceComponent) === 'ship a').length;
    }

    it('flips mid-flight identically on every peer, across a rollback, '
        + 'and a late joiner restores it', async () => {
        const gameData = await getSyntheticGameData();
        const peerA = await makePeer('a');
        const peerB = await makePeer('b');

        // Peer A flies the Bastion Hulk (one Sentry Turret), locked on a
        // skiff crossing 300 px ahead of it.
        const hulk = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.hulk));
        hulk.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(0, 0),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        hulk.components.set(ControlledByComponent, { peerId: 'a' });
        hulk.components.set(TurretAimComponent, { accurate: true });
        await completeEntity(peerA.world, hulk);
        await peerA.client.addEntity('ship a', hulk);
        const skiff = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        skiff.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(-150, -300),
            rotation: new Angle(Math.PI / 2), turnBack: false, turning: 0,
            velocity: new Vector(60, 0),
        });
        await completeEntity(peerA.world, skiff);
        await peerA.client.addEntity('target', skiff);

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
        expect(aim(peerB.world)).toEqual({ accurate: true });
        peerA.client.setTarget('target');
        peerA.client.controlEvents([{ action: 'firePrimary', state: 'start' }]);
        await step(40);

        // Peer B runs AHEAD of A, so the flip lands in its past.
        for (let i = 0; i < 4; i++) {
            peerB.host.step();
        }
        const bLog = (peerB.host as unknown as {
            rollbackLog: { event: string }[],
        }).rollbackLog;
        const rollbacksBefore = bLog.filter(e => e.event === 'rollback').length;
        const shotsBefore = shotsOf(peerA.world);
        peerA.client.setTurretAim(false);
        await step(4, [peerA]);
        await step(90);
        expect(bLog.filter(e => e.event === 'rollback').length)
            .withContext('peer B rolled back across the flip')
            .toBeGreaterThan(rollbacksBefore);
        expect(shotsOf(peerA.world)).withContext('shots after the flip')
            .toBeGreaterThan(0);
        // The flip's record came back echoed like any other: nothing of
        // A's is left awaiting the relay's confirmation.
        expect((peerA.host as unknown as {
            unconfirmedRecords: Map<number, number>,
        }).unconfirmedRecords.size).withContext('A\'s unechoed records')
            .toBe(0);
        expect(shotsBefore).toBeGreaterThanOrEqual(0);

        while (frame(peerA.world) !== frame(peerB.world)) {
            (frame(peerA.world) < frame(peerB.world) ? peerA : peerB)
                .host.step();
        }
        for (const peer of [peerA, peerB]) {
            expect(aim(peer.world)).toEqual({ accurate: false });
        }
        expectSameWorld(peerA.world, peerB.world, 'peer B after its rollback');

        // B's own setTurretAim cannot reach A's ship.
        peerB.client.setTurretAim(true);
        await step(10);
        expect(aim(peerA.world)).toEqual({ accurate: false });
        expect(aim(peerB.world)).toEqual({ accurate: false });

        // A late joiner rebuilds the room from a wire baseline.
        const peerC = await makePeer('c');
        expect(await peerC.host.joinRoom()).toBeTrue();
        while (frame(peerA.world) !== frame(peerC.world)) {
            (frame(peerA.world) < frame(peerC.world) ? peerA : peerC)
                .host.step();
        }
        expect(aim(peerC.world)).toEqual({ accurate: false });
        expectSameWorld(peerA.world, peerC.world, 'the late joiner');
    }, 120_000);
});
