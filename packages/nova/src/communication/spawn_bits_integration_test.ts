import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Angle } from 'nova_ecs/datatypes/angle';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { restoreWireWorldSnapshot } from 'nova_ecs/plugins/snapshot_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { deriveEntityComponents } from '../nova_plugin/core/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { NpcComponent } from '../nova_plugin/npc/index.js';
import { ControlledByComponent, PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/index.js';
import { makeShip, ShipComponent } from '../nova_plugin/ship/index.js';
import {
    completeEntity, loadWireSnapshotGameData, NpcSpawnerComponent,
} from '../nova_plugin/spawn/index.js';
import { MessageType } from './communicator_message.js';
import { unwrapRollbackMessage } from './rollback_protocol.js';
import { RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';
import { SocketMessage } from './socket_message.js';
import { decodeWire } from './wire_codec.js';
import { liveWireCodec, WireMessage, WireMessageType } from './wire_schemas.js';

/**
 * #140, end to end: the room's spawn bits are the first entrant's (the
 * maintainer's ruling — "let whoever entered an empty system first
 * determine the bits used for spawning stuff in the system";
 * nova_plugin/spawn/spawn_bits.ts has the design).
 *
 * The room is Vael Hollow re-cast for the spec: its only düde is a wing
 * of Shrike Ghosts (shïp AppearOn `b102`, the synthetic story variant)
 * and no flët roams it. Under the empty bit set its table is empty, so
 * genesis spawns nobody; an entrant with b102 set opens it, and Ghosts
 * jump in. Every world of the room — peers, the archive, late joiners —
 * is built from this same data, as every world of a real room is built
 * from the server's.
 */
const ROOM = SYNTHETIC.systems.vael;
const GHOST_WING = 'test:ghost wing';
const STORY_BIT = 102;

let roomDataPromise: Promise<SimulationGameDataInterface> | undefined;
function roomData(): Promise<SimulationGameDataInterface> {
    roomDataPromise ??= (async () => {
        const base = await getSyntheticGameData();
        const system = {
            ...await base.data.System.get(ROOM),
            dudes: [{ id: GHOST_WING, weight: 100 }],
            fleets: [],
            avgShips: 3,
        };
        const dude = {
            ...await base.data.Dude.get(SYNTHETIC.dudes.variants),
            id: GHOST_WING,
            ships: [{ id: SYNTHETIC.ships.ghost, weight: 100 }],
        };
        const overriding = <T>(gettable: { get(id: string): Promise<T>,
            getCached(id: string): T | undefined }, id: string, value: T) => ({
            get: (key: string) => key === id ? Promise.resolve(value)
                : gettable.get(key),
            getCached: (key: string) => key === id ? value
                : gettable.getCached(key),
        });
        const data = new Proxy(base.data, {
            get(target, key, receiver) {
                if (key === 'System') {
                    return overriding(target.System, ROOM, system);
                }
                if (key === 'Dude') {
                    return overriding(target.Dude, GHOST_WING, dude);
                }
                return Reflect.get(target, key, receiver);
            },
        });
        // No roaming flëts: the synthetic Raider Wing roams anywhere.
        const ids = base.ids.then(ids => ({ ...ids, Fleet: [] }));
        return new Proxy(base, {
            get(target, key) {
                if (key === 'data') {
                    return data;
                }
                if (key === 'ids') {
                    return ids;
                }
                const value = Reflect.get(target, key, target) as unknown;
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as SimulationGameDataInterface;
    })();
    return roomDataPromise;
}

function spawnerOf(world: World) {
    return world.entities.get('npc spawner')!.components.get(NpcSpawnerComponent)!;
}

function npcShips(world: World): string[] {
    return [...world.entities.values()]
        .filter(entity => entity.components.has(NpcComponent))
        .map(entity => entity.components.get(ShipComponent)!.id);
}

const frame = (world: World) => world.resources.get(TimeResource)!.frame;
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));

/** A player ship controlled by `peerId`, carrying `bits` (or no
 * ControlBitsComponent at all). */
async function pilotShip(world: World, peerId: string, bits?: number[]) {
    const gameData = await roomData();
    const ship = makeShip(await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
    ship.components.set(ControlledByComponent, { peerId });
    if (bits) {
        ship.components.set(ControlBitsComponent, new Set(bits));
    }
    const movement = ship.components.get(MovementStateComponent)!;
    movement.position = new Position(100, 50);
    movement.rotation = new Angle(1);
    movement.velocity = new Vector(0, 0);
    await completeEntity(world, ship);
    return ship;
}

describe('Room spawn bits (#140)', () => {
    async function makeHost(communicator?: MockCommunicator) {
        const gameData = await roomData();
        const world = await makeSystem(ROOM, gameData, 'worker');
        if (communicator) {
            world.resources.set(CommunicatorResource, communicator);
        }
        const host = new SimulationBridgeHost(world, gameData);
        const client = new SimulationBridgeClient(host,
            world.resources.get(SerializerResource)!);
        return { world, host, client };
    }

    describe('single player (no relay): the one player is the first entrant',
        () => {
            async function enterAlone(bits?: number[]) {
                const peer = await makeHost();
                // Genesis: the empty set admits nothing here, so nobody.
                expect(npcShips(peer.world)).toEqual([]);
                expect(spawnerOf(peer.world).targetCount).toBe(0);
                expect(spawnerOf(peer.world).spawnBits).toBeUndefined();
                await peer.client.addEntity('pilot',
                    await pilotShip(peer.world, 'pilot', bits));
                for (let tick = 0; tick < 30; tick++) {
                    peer.host.step();
                    await yieldTurn();
                }
                return peer;
            }

            it('spawns the story variant when the entrant has its bit set',
                async () => {
                    const { world } = await enterAlone([STORY_BIT, 7]);
                    // Only the bits the tables read are kept.
                    expect(spawnerOf(world).spawnBits).toEqual([STORY_BIT]);
                    expect(spawnerOf(world).targetCount).toBeGreaterThan(0);
                    expect(npcShips(world)).toContain(SYNTHETIC.ships.ghost);
                }, 120_000);

            it('never spawns it when the entrant does not', async () => {
                const { world } = await enterAlone([7]);
                expect(spawnerOf(world).spawnBits).toEqual([]);
                expect(spawnerOf(world).targetCount).toBe(0);
                expect(npcShips(world)).toEqual([]);
            }, 120_000);

            it('leaves a system no test gates exactly as it was', async () => {
                // Thessaly Reach (real synthetic data, unmodified): its
                // traders, patrols, roaming wing and Person list read no
                // control bit, so its spawner carries no test, no
                // AvgShips and — whoever enters — no latch.
                const gameData = await getSyntheticGameData();
                const world = await makeSystem(SYNTHETIC.systems.thessaly,
                    gameData, 'worker');
                const host = new SimulationBridgeHost(world, gameData);
                const client = new SimulationBridgeClient(host,
                    world.resources.get(SerializerResource)!);
                const genesis = JSON.stringify(spawnerOf(world));
                expect(genesis).not.toMatch(
                    /appearOn|activeOn|roamingShare|evenShare|avgShips/);
                const ship = makeShip(await gameData.data.Ship.get(
                    SYNTHETIC.ships.skiff));
                ship.components.set(ControlledByComponent, { peerId: 'pilot' });
                ship.components.set(ControlBitsComponent, new Set([STORY_BIT]));
                await completeEntity(world, ship);
                await client.addEntity('pilot', ship);
                for (let tick = 0; tick < 5; tick++) {
                    host.step();
                    await yieldTurn();
                }
                expect(world.entities.has('pilot')).toBeTrue();
                expect(spawnerOf(world).spawnBits).toBeUndefined();
            }, 120_000);

            it('reads a player ship without control bits as none set',
                async () => {
                    const { world } = await enterAlone(undefined);
                    expect(spawnerOf(world).spawnBits).toEqual([]);
                    expect(npcShips(world)).toEqual([]);
                }, 120_000);
        });

    describe('a relayed room', () => {
        let comms: Map<string, MockCommunicator>;
        let relay: RollbackRelay;
        let archive: RoomArchive;
        let desyncs: number;

        function openRoom(members: string[]) {
            comms = new Map([['server', new MockCommunicator('server')],
                ...members.map(id => [id, new MockCommunicator(id)] as const)]);
            for (const comm of comms.values()) {
                comm.mockPeers = comms;
                comm.peers.current.next(new Set(comms.keys()));
            }
            desyncs = 0;
            relay = new RollbackRelay(comms.get('server')!, {
                autoClock: false,
                baseline: () => archive.latest,
                referenceHash: tick => archive.hashAt(tick),
                // Any disagreement with the archive is a conviction.
                desyncThreshold: 1,
                onDesync: () => { desyncs++; },
            });
            archive = new RoomArchive(relay,
                async () => makeSystem(ROOM, await roomData(), 'node'),
                { intervalTicks: 60, autoUpdate: false });
        }

        /** Membership as the server sees it: the relay compares every
         * checkpoint once each CURRENT member has reported it. */
        function setMembers(members: string[]) {
            const current = new Set(['server', ...members]);
            for (const id of members) {
                if (!comms.has(id)) {
                    comms.set(id, new MockCommunicator(id, comms));
                }
            }
            for (const comm of comms.values()) {
                comm.mockPeers = comms;
                comm.peers.current.next(current);
            }
        }

        function closeRoom() {
            archive.close();
            relay.close();
        }

        afterEach(() => closeRoom());

        /** Steps the given peers and the room clock in lockstep. */
        async function run(peers: Array<{ host: SimulationBridgeHost }>,
            ticks: number) {
            for (let tick = 1; tick <= ticks; tick++) {
                for (const peer of peers) {
                    peer.host.step();
                }
                relay.advanceTicks(1);
                if (relay.tick % 60 === 0) {
                    await archive.update();
                }
                await yieldTurn();
            }
        }

        /** Steps whichever world trails until both stand on one tick. */
        function align(a: { world: World, host: SimulationBridgeHost },
            b: { world: World, host: SimulationBridgeHost }) {
            while (frame(a.world) !== frame(b.world)) {
                (frame(a.world) < frame(b.world) ? a : b).host.step();
            }
        }

        it('keeps the first entrant\'s bits for every peer, the archive and '
            + 'late joiners; a later entrant changes nothing', async () => {
                openRoom(['a']);
                // A enters the empty room with the story bit set.
                const a = await makeHost(comms.get('a'));
                await a.client.addEntity('ship a',
                    await pilotShip(a.world, 'a', [STORY_BIT]));
                await run([a], 120);
                expect(spawnerOf(a.world).spawnBits).toEqual([STORY_BIT]);
                expect(npcShips(a.world)).toContain(SYNTHETIC.ships.ghost);

                // B enters the occupied room WITHOUT the bit: its world is
                // reconstructed from the archive, and its arrival must
                // not re-decide anything.
                setMembers(['a', 'b']);
                const b = await makeHost(comms.get('b'));
                expect(await b.host.joinRoom()).toBeTrue();
                align(a, b);
                await b.client.addEntity('ship b',
                    await pilotShip(b.world, 'b', []));
                await run([a, b], 240);
                align(a, b);
                for (const world of [a.world, b.world, archive.archiveWorld!]) {
                    expect(spawnerOf(world).spawnBits).toEqual([STORY_BIT]);
                    expect(npcShips(world)).toContain(SYNTHETIC.ships.ghost);
                }
                expect(b.world.entities.has('ship b')).toBeTrue();
                expect(hashWorld(b.world, PEER_LOCAL_COMPONENTS).hash)
                    .toBe(hashWorld(a.world, PEER_LOCAL_COMPONENTS).hash);
                // The archive voted at every checkpoint and agreed.
                expect(desyncs).toBe(0);

                // The archive's baseline, restored over a fresh genesis
                // AFTER a trip through the binary wire (the catchUp a late
                // joiner receives), is the archive's world at that tick:
                // the latch rides the baseline, typed, and hashes alike.
                const baseline = archive.latest!;
                expect(baseline.tick % 60).toBe(0);
                const frameOut: WireMessage = {
                    message: {
                        type: MessageType.message,
                        message: {
                            room: ROOM, message: {
                                rollback: {
                                    kind: 'catchUp', tick: baseline.tick,
                                    records: [], baseline,
                                },
                            },
                        },
                    },
                };
                const codec = liveWireCodec();
                const decoded = decodeWire(codec, WireMessageType,
                    codec.encode(SocketMessage.encode(frameOut)));
                if (isLeft(decoded)) {
                    fail('the catchUp did not decode');
                    return;
                }
                const received = decoded.right.message;
                const catchUp = unwrapRollbackMessage(
                    received?.type === MessageType.message
                        ? received.message.message : undefined);
                if (catchUp?.kind !== 'catchUp' || !catchUp.baseline) {
                    fail('no baseline came back');
                    return;
                }
                const restored = await makeSystem(ROOM, await roomData(), 'worker');
                await loadWireSnapshotGameData(restored, catchUp.baseline.snapshot);
                restoreWireWorldSnapshot(restored, catchUp.baseline.snapshot,
                    deriveEntityComponents);
                expect(spawnerOf(restored).spawnBits).toEqual([STORY_BIT]);
                expect(hashWorld(restored, PEER_LOCAL_COMPONENTS).hash)
                    .toBe(archive.hashAt(baseline.tick)!);

                // C joins late through the real path: restored from that
                // baseline plus the log tail, it equals the live world on
                // its very first tick (A steps to meet it; C never steps).
                // (Bring the room clock up to the live world first, so the
                // catch-up tick is A's own and C need not step to meet it.)
                if (frame(a.world) > relay.tick) {
                    relay.advanceTicks(frame(a.world) - relay.tick);
                    await archive.update();
                }
                setMembers(['a', 'b', 'c']);
                const c = await makeHost(comms.get('c'));
                expect(await c.host.joinRoom()).toBeTrue();
                expect(frame(c.world)).toBeGreaterThanOrEqual(frame(a.world));
                while (frame(a.world) < frame(c.world)) {
                    a.host.step();
                }
                expect(spawnerOf(c.world).spawnBits).toEqual([STORY_BIT]);
                expect(hashWorld(c.world, PEER_LOCAL_COMPONENTS).hash)
                    .toBe(hashWorld(a.world, PEER_LOCAL_COMPONENTS).hash);

                // The entrant LEAVING does not reset the latch: the room
                // is not empty, so its world (and its bits) live on.
                setMembers(['b', 'c']);
                align(b, c);
                await run([b, c], 120);
                align(b, c);
                expect(b.world.entities.has('ship a')).toBeFalse();
                for (const world of [b.world, c.world, archive.archiveWorld!]) {
                    expect(spawnerOf(world).spawnBits).toEqual([STORY_BIT]);
                }
                expect(hashWorld(c.world, PEER_LOCAL_COMPONENTS).hash)
                    .toBe(hashWorld(b.world, PEER_LOCAL_COMPONENTS).hash);
                expect(desyncs).toBe(0);
            }, 600_000);

        it('starts over when the room empties: the next first entrant decides',
            async () => {
                // A room with the story bit latched...
                openRoom(['a']);
                const a = await makeHost(comms.get('a'));
                await a.client.addEntity('ship a',
                    await pilotShip(a.world, 'a', [STORY_BIT]));
                await run([a], 60);
                expect(spawnerOf(archive.archiveWorld!).spawnBits)
                    .toEqual([STORY_BIT]);
                // ...empties. The server closes an emptied room's relay
                // and archive (server_plugin.ts) and opens fresh ones for
                // the next arrival, who builds the system from genesis.
                closeRoom();
                openRoom(['d']);
                const d = await makeHost(comms.get('d'));
                expect(await d.host.joinRoom()).toBeTrue();
                await d.client.addEntity('ship d',
                    await pilotShip(d.world, 'd', []));
                await run([d], 120);
                for (const world of [d.world, archive.archiveWorld!]) {
                    expect(spawnerOf(world).spawnBits).toEqual([]);
                    expect(npcShips(world)).toEqual([]);
                }
                expect(desyncs).toBe(0);
            }, 300_000);
    });
});
