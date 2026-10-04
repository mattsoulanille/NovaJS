import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { NpcComponent } from '../nova_plugin/npc/index.js';
import { ControlledByComponent, PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/index.js';
import { makeShip, ShipComponent } from '../nova_plugin/ship/index.js';
import {
    completeEntity, INITIAL_SPAWN_HALF_SIZE, NpcSpawnerComponent,
} from '../nova_plugin/spawn/index.js';
import { parseRoomSeedSetting } from '../nova_plugin/server_plugin.js';
import { RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { applyInputRecords } from './simulation_input.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * #140, second ruling (admin1, 2026-10-03 22:00): "randomize it every
 * time a player intends to enter the system (and the system is not
 * already live). Then, we can use the player's bits."
 *
 * The relay mints a seed when it opens a room and logs it as the room's
 * first record (a server-authored `roomSeed` input); that record
 * reseeds the world's Random and swaps the genesis population for one
 * rolled at the first entrant's tick under the entrant's bits
 * (nova_plugin/spawn/spawn_bits.ts has the design). A world no seed
 * reaches keeps its genesis exactly as before.
 */
const STORY_BIT = 102;
const VARIANT_WING = 'test:variant wing';
const THESSALY = SYNTHETIC.systems.thessaly;
const VAEL = SYNTHETIC.systems.vael;

/**
 * Vael Hollow re-cast: its one düde flies Shrike Ghosts (`b102`) and
 * Iron Hulks (`!b102`) half and half, so an entrant with the bit can
 * only meet Ghosts and one without only Hulks. No flët roams it and no
 * përs can turn up, so every NPC is the düde's.
 */
let vaelDataPromise: Promise<SimulationGameDataInterface> | undefined;
function vaelData(): Promise<SimulationGameDataInterface> {
    vaelDataPromise ??= (async () => {
        const base = await getSyntheticGameData();
        const system = {
            ...await base.data.System.get(VAEL),
            dudes: [{ id: VARIANT_WING, weight: 100 }],
            fleets: [],
            avgShips: 6,
        };
        const dude = {
            ...await base.data.Dude.get(SYNTHETIC.dudes.variants),
            id: VARIANT_WING,
            ships: [{ id: SYNTHETIC.ships.ghost, weight: 50 },
                { id: SYNTHETIC.ships.hulk, weight: 50 }],
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
                    return overriding(target.System, VAEL, system);
                }
                if (key === 'Dude') {
                    return overriding(target.Dude, VARIANT_WING, dude);
                }
                return Reflect.get(target, key, receiver);
            },
        });
        const ids = base.ids.then(ids => ({ ...ids, Fleet: [], Pers: [] }));
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
    return vaelDataPromise;
}

function spawnerOf(world: World) {
    return world.entities.get('npc spawner')!.components.get(NpcSpawnerComponent)!;
}

function npcShips(world: World): string[] {
    return [...world.entities.values()]
        .filter(entity => entity.components.has(NpcComponent))
        .map(entity => entity.components.get(ShipComponent)!.id);
}

/** The NPC population as ship classes at (rounded) positions, sorted. */
function population(world: World): string[] {
    return [...world.entities.values()]
        .filter(entity => entity.components.has(NpcComponent))
        .map(entity => {
            const { position } = entity.components.get(MovementStateComponent)!;
            return `${entity.components.get(ShipComponent)!.id}`
                + `@${Math.round(position.x)},${Math.round(position.y)}`;
        }).sort();
}

const frame = (world: World) => world.resources.get(TimeResource)!.frame;
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));
const hash = (world: World) => hashWorld(world, PEER_LOCAL_COMPONENTS).hash;

async function pilotShip(world: World, gameData: SimulationGameDataInterface,
    peerId: string, bits?: number[]) {
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

describe('Room seed (#140: a fresh population per room instance)', () => {
    describe('fixed mode (no room seed reaches the world)', () => {
        it('reproduces the old genesis exactly', async () => {
            // Pinned at 20353ba8 (integration/rulings4), before the room
            // seed existed: the genesis world hash, the hash after 300
            // steps and the world Random's state after them, for two
            // synthetic systems (one with a Person list and a roaming
            // wing, one with a fleet entry). Specs, the determinism
            // harness and offline play build exactly these worlds.
            const gameData = await getSyntheticGameData();
            const pins: Array<[string, string, string, number[]]> = [
                [THESSALY, '8d6c6c3f', 'ad539e4f',
                    [635476003, 3134353079, 451984453, 396451034]],
                [SYNTHETIC.systems.kestrel, 'a90af946', '758103fd',
                    [4277036284, 1584214963, 126678300, 1491742349]],
            ];
            for (const [systemId, genesis, stepped, random] of pins) {
                const world = await makeSystem(systemId, gameData, 'worker');
                expect(hash(world)).withContext(systemId).toBe(genesis);
                expect(spawnerOf(world).awaitingEntrant).toBeUndefined();
                for (let i = 0; i < 300; i++) {
                    world.step();
                }
                expect(hash(world)).withContext(systemId).toBe(stepped);
                expect(world.resources.get(RandomResource)!.getState())
                    .withContext(systemId).toEqual(random);
            }
        }, 120_000);
    });

    describe('the roomSeed input', () => {
        it('is the server\'s alone: a peer-stamped one is dropped',
            async () => {
                const gameData = await getSyntheticGameData();
                const world = await makeSystem(THESSALY, gameData, 'worker');
                // A client's world: 'server' is the announced server.
                world.resources.set(CommunicatorResource,
                    new MockCommunicator('a'));
                const genesis = population(world);
                expect(genesis.length).toBeGreaterThan(0);
                applyInputRecords(world, [{ peerId: 'a', tick: 1,
                    inputs: [{ kind: 'roomSeed', seed: 7 }] }]);
                expect(population(world)).toEqual(genesis);
                expect(spawnerOf(world).awaitingEntrant).toBeUndefined();

                applyInputRecords(world, [{ peerId: 'server', tick: 1,
                    inputs: [{ kind: 'roomSeed', seed: 7 }] }]);
                expect(population(world)).toEqual([]);
                expect(spawnerOf(world).awaitingEntrant).toBeTrue();
                expect(spawnerOf(world).targetCount).toBe(0);
                // An ungated table still learns its AvgShips.
                expect(spawnerOf(world).avgShips).toBe(6);
            }, 120_000);

        it('is logged by a seeded relay as the room\'s first record, and '
            + 'by an unseeded one not at all', () => {
                for (const roomSeed of [123, undefined]) {
                    const server = new MockCommunicator('server');
                    const relay = new RollbackRelay(server,
                        { autoClock: false, roomSeed });
                    expect(relay.inputLog).toEqual(roomSeed === undefined ? []
                        : [{ peerId: 'server', tick: 1,
                            inputs: [{ kind: 'roomSeed', seed: 123 }] }]);
                    relay.close();
                }
            });

        it('is fresh per room on the server unless NOVA_ROOM_SEED pins it',
            () => {
                const fresh = parseRoomSeedSetting(undefined);
                const seeds = new Set(Array.from({ length: 8 }, () => fresh()));
                expect(seeds.size).toBeGreaterThan(1);
                for (const seed of seeds) {
                    expect(Number.isSafeInteger(seed)).toBeTrue();
                    expect(seed).toBeGreaterThanOrEqual(0);
                    expect(seed).toBeLessThan(2 ** 32);
                }
                expect(parseRoomSeedSetting('off')()).toBeUndefined();
                expect(parseRoomSeedSetting('42')()).toBe(42);
                expect(() => parseRoomSeedSetting('-1')).toThrow();
                expect(() => parseRoomSeedSetting('soon')).toThrow();
            });
    });

    describe('a seeded, relayed room', () => {
        let comms: Map<string, MockCommunicator>;
        let relay: RollbackRelay;
        let archive: RoomArchive;
        let desyncs: number;
        let systemId: string;
        let gameData: SimulationGameDataInterface;

        async function openRoom(system: string, roomSeed: number,
            data: Promise<SimulationGameDataInterface>) {
            systemId = system;
            gameData = await data;
            comms = new Map([['server', new MockCommunicator('server')]]);
            for (const comm of comms.values()) {
                comm.mockPeers = comms;
                comm.peers.current.next(new Set(comms.keys()));
            }
            desyncs = 0;
            relay = new RollbackRelay(comms.get('server')!, {
                autoClock: false,
                roomSeed,
                baseline: () => archive.latest,
                referenceHash: tick => archive.hashAt(tick),
                // Any disagreement with the archive is a conviction.
                desyncThreshold: 1,
                onDesync: () => { desyncs++; },
            });
            archive = new RoomArchive(relay,
                async () => makeSystem(system, gameData, 'node'),
                { intervalTicks: 60, autoUpdate: false });
        }

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

        let open = false;
        function closeRoom() {
            if (open) {
                archive.close();
                relay.close();
                open = false;
            }
        }
        afterEach(() => closeRoom());

        /** A peer joining the room through the real catch-up path. */
        async function join(id: string) {
            open = true;
            setMembers([...comms.keys()].filter(peer => peer !== 'server')
                .concat(comms.has(id) ? [] : [id]));
            const world = await makeSystem(systemId, gameData, 'worker');
            world.resources.set(CommunicatorResource, comms.get(id)!);
            const host = new SimulationBridgeHost(world, gameData);
            const client = new SimulationBridgeClient(host,
                world.resources.get(SerializerResource)!);
            const genesisHash = hash(world);
            const genesisPopulation = population(world);
            expect(await host.joinRoom()).toBeTrue();
            return { id, world, host, client, genesisHash, genesisPopulation };
        }
        type Peer = Awaited<ReturnType<typeof join>>;

        async function run(peers: Peer[], ticks: number,
            each?: () => void) {
            for (let tick = 1; tick <= ticks; tick++) {
                for (const peer of peers) {
                    peer.host.step();
                }
                relay.advanceTicks(1);
                if (relay.tick % 60 === 0) {
                    await archive.update();
                }
                each?.();
                await yieldTurn();
            }
        }

        function align(a: Peer, b: Peer) {
            while (frame(a.world) !== frame(b.world)) {
                (frame(a.world) < frame(b.world) ? a : b).host.step();
            }
        }

        /** Inserts `peer`'s ship and steps it (and `others`) until the
         * ship stands in its world: the entrant's tick. Returns the
         * population as of that tick. */
        async function enter(peer: Peer, others: Peer[], bits?: number[]) {
            await peer.client.addEntity(`ship ${peer.id}`,
                await pilotShip(peer.world, gameData, peer.id, bits));
            for (let i = 0; i < 120 && !peer.world.entities.has(`ship ${peer.id}`);
                i++) {
                await run([peer, ...others], 1);
            }
            expect(peer.world.entities.has(`ship ${peer.id}`)).toBeTrue();
            return population(peer.world);
        }

        it('waits empty for its first entrant, then spawns the initial '
            + 'population scattered through the system on the entrant\'s tick',
            async () => {
                await openRoom(THESSALY, 1, getSyntheticGameData());
                const a = await join('a');
                // Genesis is the fixed one; the seed record (tick 1)
                // clears it before anybody has entered.
                expect(a.genesisPopulation.length).toBeGreaterThan(0);
                await run([a], 30);
                expect(population(a.world)).toEqual([]);
                expect(spawnerOf(a.world).awaitingEntrant).toBeTrue();
                const initial = await enter(a, []);
                expect(spawnerOf(a.world).awaitingEntrant).toBeUndefined();
                expect(spawnerOf(a.world).targetCount).toBeGreaterThan(0);
                expect(initial.length)
                    .toBeGreaterThanOrEqual(spawnerOf(a.world).targetCount);
                // Scattered (genesis placement), not jumping in at the
                // edge: the entrant finds the system already populated.
                for (const entity of a.world.entities.values()) {
                    if (entity.components.has(NpcComponent)) {
                        const { position } =
                            entity.components.get(MovementStateComponent)!;
                        expect(Math.abs(position.x))
                            .toBeLessThanOrEqual(INITIAL_SPAWN_HALF_SIZE + 50);
                        expect(Math.abs(position.y))
                            .toBeLessThanOrEqual(INITIAL_SPAWN_HALF_SIZE + 50);
                    }
                }
                // An ungated table latches no bits, as before.
                expect(spawnerOf(a.world).spawnBits).toBeUndefined();
            }, 300_000);

        it('holds identical worlds on every peer and the archive; a joiner '
            + 'does not re-roll a live room; an emptied room re-rolls',
            async () => {
                // Visit 1. A and B both build the room's genesis and join
                // before anyone has entered.
                await openRoom(THESSALY, 1, getSyntheticGameData());
                const a = await join('a');
                const b = await join('b');
                expect(b.genesisHash).toBe(a.genesisHash);
                align(a, b);
                expect(hash(b.world)).toBe(hash(a.world));
                const visit1 = await enter(a, [b]);
                // B, entering the live room, changes nothing.
                await enter(b, [a], [STORY_BIT]);
                await run([a, b], 300);
                align(a, b);
                expect(hash(b.world)).toBe(hash(a.world));
                const archiveWorld = archive.archiveWorld!;
                await archive.update();
                for (const world of [a.world, b.world, archiveWorld]) {
                    expect(spawnerOf(world).awaitingEntrant).toBeUndefined();
                }
                // The archive voted at every checkpoint from tick 0 on and
                // agreed with both.
                expect(desyncs).toBe(0);

                // The fixed genesis population is not what the room got.
                const fixed = population(
                    await makeSystem(THESSALY, gameData, 'worker'));
                expect(visit1).not.toEqual(fixed);

                // The room empties: the server closes its relay and
                // archive (server_plugin.ts) and the next entrant opens a
                // new room instance, with a new seed.
                closeRoom();
                await openRoom(THESSALY, 2, getSyntheticGameData());
                const d = await join('d');
                const visit2 = await enter(d, []);
                expect(visit2.length).toBeGreaterThan(0);
                expect(visit2).not.toEqual(visit1);
                await run([d], 120);
                expect(desyncs).toBe(0);

                // The same seed again is the same room, draw for draw.
                closeRoom();
                await openRoom(THESSALY, 1, getSyntheticGameData());
                const e = await join('e');
                const again = await enter(e, []);
                expect(again.map(entry => entry.split('@')[0]))
                    .toEqual(visit1.map(entry => entry.split('@')[0]));
            }, 600_000);

        for (const withBit of [true, false]) {
            it(withBit
                ? 'puts the entrant\'s allowed story variant in the INITIAL '
                + 'population, and never the one its bit excludes'
                : 'never shows an entrant without the bit the variant it '
                + 'gates, from the first tick on', async () => {
                    await openRoom(VAEL, 5, vaelData());
                    const a = await join('a');
                    const seen = new Set<string>();
                    const watch = () => npcShips(a.world)
                        .forEach(ship => seen.add(ship));
                    await run([a], 10, watch);
                    expect(seen.size).toBe(0);
                    await enter(a, [], withBit ? [STORY_BIT] : []);
                    const allowed = withBit ? SYNTHETIC.ships.ghost
                        : SYNTHETIC.ships.hulk;
                    const excluded = withBit ? SYNTHETIC.ships.hulk
                        : SYNTHETIC.ships.ghost;
                    // On the entrant's very tick: the initial population.
                    expect(npcShips(a.world)).toContain(allowed);
                    expect(npcShips(a.world)).not.toContain(excluded);
                    expect(spawnerOf(a.world).spawnBits)
                        .toEqual(withBit ? [STORY_BIT] : []);
                    await run([a], 300, watch);
                    expect(seen.has(excluded)).toBeFalse();
                    expect(desyncs).toBe(0);
                    // The archive built the same room from the log.
                    await archive.update();
                    const archived = archive.archiveWorld!;
                    expect(npcShips(archived)).not.toContain(excluded);
                    expect(spawnerOf(archived).spawnBits)
                        .toEqual(withBit ? [STORY_BIT] : []);
                }, 300_000);
        }

        it('lets a reconnecting peer re-enter without re-rolling the room '
            + 'or re-latching its spawn bits (#354 meets #140)', async () => {
            // Integration: a reconnect hands the peer a NEW uuid; the
            // server's removePeer takes the old one's fleet out of the
            // room and the host re-enters under the new id — a resync, then
            // the fleet re-inserted (simulation_bridge_host.ts reenter).
            // The room is still live, so its seed record (tick 1) must not
            // roll it again, and the re-inserted ship — a ControlledBy
            // ship, which is what the spawner latches on — must not latch
            // the bits again.
            await openRoom(VAEL, 9, vaelData());
            const a = await join('a');
            const b = await join('b');
            align(a, b);
            await enter(a, [b], [STORY_BIT]);
            // B, without the bit, enters the live room: no re-latch.
            await enter(b, [a], []);
            await run([a, b], 120);
            align(a, b);
            const before = new Set([...a.world.entities.keys()].filter(uuid =>
                a.world.entities.get(uuid)!.components.has(NpcComponent)));
            expect(before.size).toBeGreaterThan(0);

            // A's socket drops and comes straight back under a new uuid.
            const comm = comms.get('a')!;
            comms.delete('a');
            comm.uuid = 'a2';
            comms.set('a2', comm);
            setMembers(['b', 'a2']);
            for (let i = 0; i < 300
                && !(a.world.entities.get('ship a')?.components
                    .get(ControlledByComponent)?.peerId === 'a2'); i++) {
                await run([a, b], 1);
            }
            expect(a.world.entities.get('ship a')?.components
                .get(ControlledByComponent)?.peerId)
                .withContext('the player ship, re-inserted under the new id')
                .toBe('a2');
            await run([a, b], 240);
            align(a, b);
            await archive.update();

            for (const world of [a.world, b.world, archive.archiveWorld!]) {
                expect(world.entities.get('ship a')?.components
                    .get(ControlledByComponent)?.peerId).toBe('a2');
                expect(spawnerOf(world).awaitingEntrant).toBeUndefined();
                expect(spawnerOf(world).spawnBits).toEqual([STORY_BIT]);
                expect(npcShips(world)).not.toContain(SYNTHETIC.ships.hulk);
            }
            // Not re-rolled: whatever of the pre-reconnect population is
            // still in the system is the same ships, on every world.
            const survivors = [...before].filter(uuid => b.world.entities.has(uuid));
            expect(survivors.length).toBeGreaterThan(0);
            for (const uuid of survivors) {
                expect(a.world.entities.has(uuid)).withContext(uuid).toBeTrue();
            }
            expect(hash(a.world)).toBe(hash(b.world));
            expect(desyncs).toBe(0);
        }, 300_000);

        it('restores a late joiner to the live world', async () => {
            await openRoom(VAEL, 9, vaelData());
            const a = await join('a');
            await enter(a, [], [STORY_BIT]);
            await run([a], 180);
            expect(archive.latest).toBeDefined();
            // Bring the room clock up to the live world, so the joiner's
            // catch-up tick is A's own.
            if (frame(a.world) > relay.tick) {
                relay.advanceTicks(frame(a.world) - relay.tick);
                await archive.update();
            }
            const c = await join('c');
            while (frame(a.world) < frame(c.world)) {
                a.host.step();
            }
            expect(npcShips(c.world)).toContain(SYNTHETIC.ships.ghost);
            expect(spawnerOf(c.world).spawnBits).toEqual([STORY_BIT]);
            expect(hash(c.world)).toBe(hash(a.world));
            // ...and a joiner without the bit leaves the room as it is.
            await enter(c, [a], []);
            await run([a, c], 120);
            align(a, c);
            expect(hash(c.world)).toBe(hash(a.world));
            expect(spawnerOf(c.world).spawnBits).toEqual([STORY_BIT]);
            expect(npcShips(c.world)).not.toContain(SYNTHETIC.ships.hulk);
            expect(desyncs).toBe(0);
        }, 300_000);
    });
});
