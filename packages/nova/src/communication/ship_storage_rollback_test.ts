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
import { insertPlayerAndFleet } from '../client/fleet_insertion.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    decodeSave, encodeSave, extractSaveData, restorePlayerState,
} from '../nova_plugin/pilot/index.js';
import {
    ControlledByComponent, CreditsComponent, GameDateComponent, MissionsComponent,
    PEER_LOCAL_COMPONENTS, PlayerEscortComponent, StoredShip,
    StoredShipsComponent,
} from '../nova_plugin/player/index.js';
import {
    CargoComponent, FuelComponent, makeShip, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { CarriedEscort } from '../spaceport/landed_escorts.js';
import { LandedTransaction } from '../spaceport/landed_transaction.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import {
    buildEscortFromRecord, escortToStorage, StorageLookups, storedShipsOf,
    storedToEscort, swapWithEscort, swapWithStored,
} from '../spaceport/ship_storage.js';
import { RollbackRelay } from './rollback_relay.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * ============================================================================
 * Ship storage across a room: a docked visit, the lift-off, a rollback
 * ============================================================================
 *
 * Every hangar operation (spaceport/ship_storage.ts) is a LANDED change: it
 * edits the held hull and the client's landed roster, and nothing reaches
 * a world until the lift-off's insertion records do. Here a pilot docks,
 * runs all four operations through the landing's transaction exactly as
 * the hangar does (swap with a stored ship, swap with a captured escort,
 * store an escort, send a stored ship along as an escort), commits, and
 * lifts off through the real insertion sequence (insertPlayerAndFleet).
 * A second peer that has simulated PAST the records' tick rolls back and
 * resimulates through them, and a late joiner rebuilds the room from a
 * wire baseline: all three agree hash for hash, and every one of them has
 * the pilot in the prize hull with the stored list and the two escorts.
 * The pilot's save, written from the world, carries the list too.
 */
describe('ship storage in a room', () => {
    const PILOT = 'ship a';
    const PORT = SYNTHETIC.planets.port;
    const { skiff, corsair, warden } = SYNTHETIC.ships;
    const { blaster, charter, missileAmmo } = SYNTHETIC.outfits;
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

    function record(ship: string, fields: Partial<StoredShip> = {}):
        StoredShip {
        return {
            ship, name: ship, outfits: [], cargo: [], fuel: 100,
            storedAt: 'nova:999', ...fields,
        };
    }

    function movement(x: number, y: number) {
        return {
            accelerating: 0, position: new Position(x, y),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        };
    }

    /** The pilot's ships in a world: class -> PlayerEscort provenance. */
    function fleetIn(world: World): string[] {
        const fleet: string[] = [];
        for (const [, entity] of world.entities) {
            const marker = entity.components.get(PlayerEscortComponent);
            if (marker?.player === PILOT) {
                fleet.push(`${entity.components.get(ShipComponent)?.id}`
                    + `:${marker.provenance}`);
            }
        }
        return fleet.sort();
    }

    it('lifts off with the hangar\'s changes; a peer that rolls back across '
        + 'the lift-off and a late joiner hold the same pilot and fleet',
        async () => {
            const gameData = await getSyntheticGameData();
            await Promise.all([skiff, corsair, warden].map(id =>
                gameData.data.Ship.get(id)));
            await Promise.all([blaster, charter, missileAmmo].map(id =>
                gameData.data.Outfit.get(id)));
            const lookups: StorageLookups = {
                getShip: id => gameData.data.Ship.getCached(id),
                getOutfit: id => gameData.data.Outfit.getCached(id),
            };
            const peerA = await makePeer('a');
            const peerB = await makePeer('b');

            // Peer B's own ship, so the room is not empty before the
            // lift-off.
            const other = makeShip(await gameData.data.Ship.get(skiff));
            other.components.set(MovementStateComponent, movement(500, 500));
            other.components.set(ControlledByComponent, { peerId: 'b' });
            await completeEntity(peerB.world, other);
            await peerB.client.addEntity('ship b', other);

            // THE DOCKED PILOT: a skiff with a persistent charter, a warden in
            // storage, two captured corsairs landed with them.
            const hull = makeShip(await gameData.data.Ship.get(skiff));
            hull.components.set(MovementStateComponent, movement(0, 0));
            hull.components.set(ControlledByComponent, { peerId: 'a' });
            hull.components.set(CreditsComponent, { credits: 9_000 });
            hull.components.set(GameDateComponent,
                { day: 1, month: 1, year: 1177 });
            hull.components.set(MissionsComponent, new Map());
            hull.components.set(ControlBitsComponent, new Set<number>());
            hull.components.set(ActiveRanksComponent, new Set());
            hull.components.set(CargoComponent, new Map([['cargo:0', 3]]));
            hull.components.set(OutfitsStateComponent, new Map([
                [blaster, { count: 1 }], [charter, { count: 1 }],
            ]));
            hull.components.set(StoredShipsComponent, [record(warden, {
                outfits: [[blaster, 2]], fuel: 150,
            })]);
            const roster: CarriedEscort[] = [
                {
                    player: PILOT, uuid: 'prize 1',
                    entity: buildEscortFromRecord(record(corsair,
                        { outfits: [[missileAmmo, 4]], cargo: [['cargo:2', 1]] }),
                        PILOT, lookups),
                },
                {
                    player: PILOT, uuid: 'prize 2',
                    entity: buildEscortFromRecord(record(corsair), PILOT,
                        lookups),
                },
            ];

            // THE VISIT, as the hangar runs it: each new hull adopted by
            // the landing's transaction like a purchase.
            const transaction = await LandedTransaction.open(hull, gameData,
                new MissionUniverse(gameData), PORT);
            const visit = transaction.savepoint('shipyard');
            // 1. Fly the stored warden; the skiff goes into its slot.
            transaction.adoptPurchasedShip(
                swapWithStored(transaction.ship, 0, PORT, lookups));
            // 2. Swap with prize 1: fly the corsair; the warden escorts.
            const swapped = swapWithEscort(transaction.ship, roster[0].entity,
                PORT, PILOT, lookups);
            roster[0] = { ...roster[0], entity: swapped.escort };
            transaction.adoptPurchasedShip(swapped.hull);
            // 3. Store prize 2.
            escortToStorage(transaction.ship, roster[1].entity, PORT, lookups);
            roster.splice(1, 1);
            // 4. The skiff out of storage as an escort.
            roster.push({
                player: PILOT, uuid: 'from storage',
                entity: storedToEscort(transaction.ship, 0, PILOT, lookups),
            });
            transaction.release(visit);
            const launching = transaction.commit();
            launching.components.set(MovementStateComponent, movement(0, 0));

            expect(launching.components.get(ShipComponent))
                .toEqual({ id: corsair });
            expect(launching.components.get(CreditsComponent))
                .toEqual({ credits: 9_000 });
            const expectedStored = storedShipsOf(launching);
            expect(expectedStored.map(ship => ship.ship)).toEqual([corsair]);

            const step = async (ticks: number, peers = [peerA, peerB]) => {
                for (let i = 0; i < ticks; i++) {
                    for (const peer of peers) {
                        peer.host.step();
                    }
                    relay.advanceTicks(1);
                    await settle();
                }
            };
            await step(10);

            // Peer B runs AHEAD, so the lift-off's records land in its past.
            for (let i = 0; i < 4; i++) {
                peerB.host.step();
            }
            const bLog = (peerB.host as unknown as {
                rollbackLog: { event: string }[],
            }).rollbackLog;
            const rollbacksBefore =
                bLog.filter(e => e.event === 'rollback').length;
            let minted = 0;
            const inserted = await insertPlayerAndFleet({
                bridge: {
                    addEntity: async (uuid: string, entity: Entity) => {
                        await peerA.client.addEntity(uuid, entity);
                    },
                }, playerUuid: PILOT, player: launching,
                escorts: roster, ownerUuid: 'a', baseSlot: 0,
                mintUuid: () => `escort ${minted++}`,
                getShip: id => gameData.data.Ship.get(id),
            });
            expect(inserted.failed).toEqual([]);
            await step(60);
            expect(bLog.filter(e => e.event === 'rollback').length)
                .withContext('peer B rolled back across the lift-off')
                .toBeGreaterThan(rollbacksBefore);

            while (frame(peerA.world) !== frame(peerB.world)) {
                (frame(peerA.world) < frame(peerB.world) ? peerA : peerB)
                    .host.step();
            }
            const peerC = await makePeer('c');
            expect(await peerC.host.joinRoom()).toBeTrue();
            while (frame(peerA.world) !== frame(peerC.world)) {
                (frame(peerA.world) < frame(peerC.world) ? peerA : peerC)
                    .host.step();
            }

            for (const [name, peer] of [['A', peerA], ['B', peerB],
                ['C', peerC]] as const) {
                const pilot = peer.world.entities.get(PILOT);
                expect(pilot?.components.get(ShipComponent))
                    .withContext(`peer ${name}'s pilot`).toEqual({ id: corsair });
                expect(pilot?.components.get(StoredShipsComponent))
                    .withContext(`peer ${name}'s stored ships`)
                    .toEqual(expectedStored);
                // The prize's missiles came along, the charter followed the
                // pilot.
                expect(pilot?.components.get(OutfitsStateComponent)?.get(
                    missileAmmo)?.count).withContext(`peer ${name}`).toBe(4);
                expect(pilot?.components.get(OutfitsStateComponent)?.get(
                    charter)?.count).withContext(`peer ${name}`).toBe(1);
                expect(fleetIn(peer.world)).withContext(`peer ${name}'s fleet`)
                    .toEqual([`${skiff}:captured`, `${warden}:captured`]);
            }
            expectSameWorld(peerA.world, peerB.world,
                'peer B after its rollback');
            expectSameWorld(peerA.world, peerC.world, 'the late joiner');

            // The pilot's save, written from the world, keeps the list.
            const flying = peerA.world.entities.get(PILOT)!;
            const saved = decodeSave(encodeSave(
                extractSaveData(flying, SYNTHETIC.systems.thessaly)!))!;
            expect(saved.storedShips).toEqual(expectedStored);
            const restored = new Entity('restored');
            restorePlayerState(restored, saved);
            expect(restored.components.get(StoredShipsComponent))
                .toEqual(expectedStored);
            // The fuel each hull went in with is what it came out with.
            expect(flying.components.get(FuelComponent)).toBeDefined();
        }, 120_000);
});
