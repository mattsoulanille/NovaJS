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
    ControlledByComponent, CreditsComponent, DominatedComponent,
    GameDateComponent, PEER_LOCAL_COMPONENTS, PendingStellarSetStringsComponent,
} from '../nova_plugin/player/index.js';
import {
    CombatRatingComponent, LegalRecordsComponent,
} from '../nova_plugin/reputation/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { buildStellarSetString } from '../spaceport/ship_mission_accept.js';
import { RollbackRelay } from './rollback_relay.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * ============================================================================
 * A stellar's OnDominate, across a room
 * ============================================================================
 *
 * Peer A demands tribute of Port Amberline (synthetic: no defence fleet, so
 * it gives in at once; its OnDominate sets BITS.portDominated). The
 * simulation owes A the string; A's client resolves it against its own view
 * (buildStellarSetString) and sends the `stellarSetString` record. It
 * crosses a real relay to peer B, which has simulated PAST the record's
 * tick — so B rolls back and resimulates through it — and peer C joins late
 * and rebuilds the world from the log. All three agree hash for hash, and
 * the bit is set on A's ship and on no one else's.
 */
describe('a stellar\'s OnDominate in a room', () => {
    const PORT = SYNTHETIC.planets.port;
    const PORT_UUID = `planet ${PORT}`;
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

    function expectPaid(world: World, who: string) {
        const a = world.entities.get('ship a')!;
        const b = world.entities.get('ship b')!;
        expect(a.components.get(DominatedComponent))
            .withContext(`${who}: A dominates`).toEqual([PORT]);
        expect(a.components.get(ControlBitsComponent)?.has(BITS.portDominated))
            .withContext(`${who}: A's OnDominate`).toBeTrue();
        expect(a.components.get(PendingStellarSetStringsComponent)?.pending)
            .withContext(`${who}: A's debt`).toEqual([]);
        expect(b.components.get(ControlBitsComponent)?.has(BITS.portDominated))
            .withContext(`${who}: not B's`).toBeFalse();
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
        ship.components.set(CombatRatingComponent, { kills: 12_800 });
        ship.components.set(LegalRecordsComponent, new Map());
        ship.components.set(ControlBitsComponent, new Set<number>());
        ship.components.set(ActiveRanksComponent, new Set());
        return ship;
    }

    it('is applied identically after a rollback resimulation, on the '
        + 'demander only, and a late joiner\'s restored world matches',
        async () => {
            const gameData = await getSyntheticGameData();
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
            await step(20);
            peerA.client.hail({ kind: 'demandTribute', target: PORT_UUID });
            await step(10);
            const owed = peerA.world.entities.get('ship a')!.components
                .get(PendingStellarSetStringsComponent)?.pending;
            expect(owed).toEqual([{ seq: 0, planetId: PORT, kind: 'dominate' }]);

            // The OnDominate, resolved against peer A's own view of its ship.
            const universe = MissionUniverse.shared(gameData);
            const effects = await buildStellarSetString(
                peerA.world.entities.get('ship a')!,
                await gameData.data.Planet.get(PORT), 'dominate', gameData,
                universe, { systemId: SYNTHETIC.systems.thessaly });
            expect(effects).toEqual({ bitsSet: [BITS.portDominated] });

            // Peer B runs AHEAD of A, so A's record lands in B's past.
            for (let i = 0; i < 4; i++) {
                peerB.host.step();
            }
            const bLog = (peerB.host as unknown as {
                rollbackLog: { event: string }[],
            }).rollbackLog;
            const rollbacksBefore = bLog.filter(e => e.event === 'rollback').length;
            await peerA.client.stellarSetString(
                { seq: 0, planetId: PORT, ...effects });
            await step(4, [peerA]);
            await step(30);
            expect(bLog.filter(e => e.event === 'rollback').length)
                .withContext('peer B rolled back across the record')
                .toBeGreaterThan(rollbacksBefore);

            while (frame(peerA.world) !== frame(peerB.world)) {
                (frame(peerA.world) < frame(peerB.world) ? peerA : peerB).host.step();
            }
            expectPaid(peerA.world, 'peer A');
            expectPaid(peerB.world, 'peer B');
            expectSameWorld(peerA.world, peerB.world, 'peer B after its rollback');

            const peerC = await makePeer('c');
            expect(await peerC.host.joinRoom()).toBeTrue();
            while (frame(peerA.world) !== frame(peerC.world)) {
                (frame(peerA.world) < frame(peerC.world) ? peerA : peerC).host.step();
            }
            expectPaid(peerC.world, 'the late joiner');
            expectSameWorld(peerA.world, peerC.world, 'the late joiner');
        }, 120_000);
});
