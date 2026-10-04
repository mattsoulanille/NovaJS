import 'jasmine';
import * as http from 'http';
import { AddressInfo } from 'net';
import { v4 } from 'uuid';
import { Entity } from 'nova_ecs/entity';
import { Communicator, CommunicatorResource, MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Position } from 'nova_ecs/datatypes/position';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Vector } from 'nova_ecs/datatypes/vector';
import { World } from 'nova_ecs/world';
import { isLeft } from 'fp-ts/lib/Either.js';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { ClientState, LiveSystem } from '../client/client_state.js';
import { insertPlayerAndFleet } from '../client/fleet_insertion.js';
import { FleetLedger } from '../client/fleet_ledger.js';
import { restampHeldFleet } from '../client/identity.js';
import { resetWarnThrottle } from '../common/log_throttle.js';
import { connectUrlWithVersion } from '../common/version_handshake.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { ControlledByComponent } from '../nova_plugin/player/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { CommunicatorClient } from './communicator_client.js';
import { CommunicatorServer } from './communicator_server.js';
import { MultiRoom } from './multi_room_communicator.js';
import { unwrapRollbackMessage } from './rollback_protocol.js';
import { DesyncInfo, RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';
import { SocketChannelClient } from './socket_channel_client.js';
import { SocketChannelServer } from './socket_channel_server.js';
import {
    forwardRoomToWorker, WorkerRoomCommunicator, workerRoomState,
} from './worker_room_communicator.js';

const BUILD = 'reconnect-reentry-build';
const SYSTEM = SYNTHETIC.systems.thessaly;

/**
 * The browser's simulation worker sees the room through the main thread's
 * forwarding (client/system_entry.ts): the same WorkerRoomCommunicator and
 * forwardRoomToWorker the browser uses, so the spec drives the worker's
 * view of its own identity, not the room's live getter. `forwardIdentity:
 * false` withholds identity updates — a worker that only ever learned its
 * init-time uuid, the shape of the incident (#354).
 */
function workerView(room: Communicator, forwardIdentity: boolean):
    WorkerRoomCommunicator {
    const worker = new WorkerRoomCommunicator(
        (message, destination) => room.sendMessage(message, destination),
        workerRoomState(room));
    forwardRoomToWorker(room, {
        receiveRoomMessage: (source, message) =>
            worker.receiveMessage(source, message),
        updateRoomState: state => {
            if (!forwardIdentity && 'uuid' in state) {
                return;
            }
            worker.updateRoomState(state);
        },
    });
    return worker;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function until(condition: () => boolean, what: string, ms = 10_000) {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > ms) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await sleep(5);
    }
}

/**
 * #354: the server assigns a peer uuid per SOCKET, so a reconnect (any
 * network drop, a server restart with a tab in the game) gives the
 * client a NEW uuid mid-game. Real sockets, real relay and archive, the
 * same server stack server_plugin builds; the clients' simulation sees the
 * room through the browser worker's forwarding.
 */
describe('a socket reconnect mid-game (#354)', () => {
    let httpServer: http.Server;
    let channel: SocketChannelServer;
    let relay: RollbackRelay;
    let archive: RoomArchive;
    let desyncs: DesyncInfo[];
    /** Every stateHash the relay received, by reporter. */
    let reports: { source: string, tick: number, hash: string }[];
    let port: number;
    let sockets: SocketChannelClient[];
    let peers: Peer[];

    async function startServer(listenPort = 0) {
        httpServer = http.createServer();
        channel = new SocketChannelServer({
            server: httpServer, buildVersion: BUILD, warn: () => undefined,
            timeout: 600_000,
        });
        await new Promise<void>(resolve =>
            httpServer.listen(listenPort, () => resolve()));
        port = (httpServer.address() as AddressInfo).port;
        const serverRoom = new MultiRoom(new CommunicatorServer(channel))
            .join(SYSTEM);
        serverRoom.messages.subscribe(({ source, message }) => {
            const unwrapped = unwrapRollbackMessage(message);
            if (unwrapped?.kind === 'stateHash') {
                reports.push({ source, tick: unwrapped.tick, hash: unwrapped.hash });
            }
        });
        relay = new RollbackRelay(serverRoom, {
            autoClock: false,
            baseline: () => archive?.latest,
            freshBaseline: () => archive?.captureState(),
            referenceHash: tick => archive?.hashAt(tick),
            onDesync: info => desyncs.push(info),
        });
        const gameData = await getSyntheticGameData();
        archive = new RoomArchive(relay,
            () => makeSystem(SYSTEM, gameData, 'node', { npcs: false }),
            { autoUpdate: false, intervalTicks: 600 });
    }

    async function stopServer() {
        relay.close();
        archive.close();
        for (const client of channel.wss.clients) {
            client.terminate();
        }
        channel.wss.close();
        await new Promise<void>(resolve => httpServer.close(() => resolve()));
    }

    beforeEach(async () => {
        resetWarnThrottle();
        desyncs = [];
        reports = [];
        sockets = [];
        peers = [];
        await startServer();
    });

    afterEach(async () => {
        for (const socket of sockets) {
            socket.disconnect();
            clearTimeout((socket as unknown as {
                keepaliveTimeout?: NodeJS.Timeout }).keepaliveTimeout);
        }
        await stopServer();
    });

    interface Peer {
        name: string;
        socket: SocketChannelClient;
        communicator: CommunicatorClient;
        room: Communicator;
        world: World;
        host: SimulationBridgeHost;
        client: SimulationBridgeClient;
        shipUuid: string;
    }

    async function makePlayerShip(world: World, owner: string, x: number) {
        const gameData = await getSyntheticGameData();
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const ship = makeShip(shipData!);
        // Stamped the way the client stamps the player (player_start.ts,
        // fleet_insertion.ts): owned and controlled by this socket's uuid.
        ship.components.set(ControlledByComponent, { peerId: owner });
        ship.components.set(MultiplayerData, { owner });
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(x, 50);
        movement.rotation = new Angle(1);
        movement.velocity = new Vector(0, 0);
        await completeEntity(world, ship);
        return ship;
    }

    async function makePeer(name: string, x: number,
        { forwardIdentity = true } = {}): Promise<Peer> {
        const gameData = await getSyntheticGameData();
        const socket = new SocketChannelClient({
            webSocketFactory: () => new WebSocket(
                connectUrlWithVersion(`ws://127.0.0.1:${port}`, BUILD)),
            warn: () => undefined,
            timeout: 600_000,
        });
        sockets.push(socket);
        const communicator = new CommunicatorClient(socket);
        const room = new MultiRoom(communicator).join(SYSTEM);
        await until(() => communicator.uuid !== undefined
            && room.peers.current.value.has('server')
            && room.peers.current.value.has(communicator.uuid),
            `${name} in the room`);
        const world = await makeSystem(SYSTEM, gameData, 'worker', { npcs: false });
        world.resources.set(CommunicatorResource,
            workerView(room, forwardIdentity));
        const host = new SimulationBridgeHost(world, gameData);
        const serializer = world.resources.get(SerializerResource)!;
        const client = new SimulationBridgeClient(host, serializer);
        expect(await host.joinRoom()).toBeTrue();
        const shipUuid = `ship ${name}`;
        await client.addEntity(shipUuid,
            await makePlayerShip(world, communicator.uuid!, x));
        const peer = { name, socket, communicator, room, world, host, client, shipUuid };
        peers.push(peer);
        return peer;
    }

    async function step(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            for (const peer of peers) {
                peer.host.step();
            }
            relay.advanceTicks(1);
            if (relay.tick % 30 === 0) {
                await archive.update();
            }
            await sleep(1);
        }
    }

    /** Reconnects a peer's socket and waits until it is back in the room
     * under its NEW uuid. */
    async function reconnect(peer: Peer): Promise<{ before: string, after: string }> {
        const before = peer.communicator.uuid!;
        peer.socket.reconnect();
        await until(() => peer.communicator.uuid !== undefined
            && peer.communicator.uuid !== before
            && peer.room.peers.current.value.has(peer.communicator.uuid),
            `${peer.name} back in the room under a new uuid`);
        const after = peer.communicator.uuid!;
        expect(after).not.toBe(before);
        return { before, after };
    }

    const stamps = (world: World | undefined, uuid: string) => {
        const entity = world?.entities.get(uuid);
        return entity && {
            owner: entity.components.get(MultiplayerData)?.owner,
            controller: entity.components.get(ControlledByComponent)?.peerId,
        };
    };

    /** No conviction, and the peer's checkpoint reports since `fromTick`
     * match the archive (the log's true simulation) — several of them, so
     * "no desync" is not a peer that simply stopped reporting. */
    function expectInLockstep(peer: Peer, fromTick: number) {
        expect(desyncs.map(d => `tick ${d.tick}: ${d.convicted.join()}`))
            .toEqual([]);
        const mine = reports.filter(report =>
            report.source === peer.communicator.uuid && report.tick >= fromTick
            && archive.hashAt(report.tick) !== undefined);
        expect(mine.length).withContext(`${peer.name}'s matched checkpoints`)
            .toBeGreaterThanOrEqual(5);
        for (const report of mine) {
            expect(report.hash).withContext(`${peer.name} at ${report.tick}`)
                .toBe(archive.hashAt(report.tick)!);
        }
    }

    /** An escort-like ship the peer inserted: OWNED (MultiplayerData), not
     * controlled — what hired escorts, bay fighters and mission ships are. */
    async function addOwnedShip(peer: Peer, uuid: string, x: number) {
        const ship = await makePlayerShip(peer.world, peer.communicator.uuid!, x);
        ship.components.delete(ControlledByComponent);
        await peer.client.addEntity(uuid, ship);
    }

    it('re-enters the room under the new uuid with zero desyncs, a second peer converging', async () => {
        const a = await makePeer('a', 100);
        await addOwnedShip(a, 'escort a', 150);
        await step(5);
        const b = await makePeer('b', -100);
        await step(240);
        expect(desyncs).toEqual([]);

        const { after } = await reconnect(a);
        const rejoinedAt = relay.tick;
        await step(900);
        await archive.update();

        expectInLockstep(a, rejoinedAt);
        expectInLockstep(b, rejoinedAt);
        // The ship is in the room (the archive is the log's true
        // simulation), owned and controlled by the CURRENT connection,
        // and the second peer agrees. So is the ship it merely owns.
        const expected = { owner: after, controller: after };
        expect(stamps(archive.archiveWorld, a.shipUuid)).toEqual(expected);
        expect(stamps(b.world, a.shipUuid)).toEqual(expected);
        expect(stamps(a.world, a.shipUuid)).toEqual(expected);
        const owned = { owner: after, controller: undefined };
        expect(stamps(archive.archiveWorld, 'escort a')).toEqual(owned);
        expect(stamps(b.world, 'escort a')).toEqual(owned);
        expect(stamps(a.world, 'escort a')).toEqual(owned);
        // b's own ship never moved owners.
        expect(stamps(archive.archiveWorld, b.shipUuid)).toEqual(
            { owner: b.communicator.uuid, controller: b.communicator.uuid });
    }, 120_000);

    it('re-enters a RESTARTED server, which has no memory of either peer', async () => {
        const a = await makePeer('a', 100);
        await addOwnedShip(a, 'escort a', 150);
        await step(5);
        const b = await makePeer('b', -100);
        await step(240);
        expect(desyncs).toEqual([]);

        // The server process restarts on the same port with a fresh relay
        // and archive (the incident: a tab left in the game).
        await stopServer();
        desyncs = [];
        reports = [];
        await startServer(port);
        const reconnectedA = await reconnect(a);
        const reconnectedB = await reconnect(b);
        await step(900);
        await archive.update();

        expectInLockstep(a, 0);
        expectInLockstep(b, 0);
        for (const [peer, { after }] of [[a, reconnectedA], [b, reconnectedB]] as const) {
            const expected = { owner: after, controller: after };
            expect(stamps(archive.archiveWorld, peer.shipUuid)).toEqual(expected);
            expect(stamps(a.world, peer.shipUuid)).toEqual(expected);
            expect(stamps(b.world, peer.shipUuid)).toEqual(expected);
        }
        const owned = { owner: reconnectedA.after, controller: undefined };
        expect(stamps(archive.archiveWorld, 'escort a')).toEqual(owned);
        expect(stamps(b.world, 'escort a')).toEqual(owned);
    }, 120_000);

    it('keeps the ship it was docked with: a reconnect while landed, then the lift-off', async () => {
        const a = await makePeer('a', 100);
        await step(5);
        const b = await makePeer('b', -100);
        await step(120);
        // Landing: the ship leaves the simulation and the client holds the
        // hull (client_state.ts DockedShip) — a decoded copy, as the
        // landing event hands it over.
        const serializer = a.world.resources.get(SerializerResource)!;
        const decoded = serializer.decode(structuredClone(
            serializer.encode(a.world.entities.get(a.shipUuid)!)));
        if (isLeft(decoded)) {
            throw new Error('Failed to decode the docked hull');
        }
        const hull: Entity = decoded.right;
        a.client.removeEntity(a.shipUuid);
        await step(60);
        expect(archive.archiveWorld!.entities.has(a.shipUuid)).toBeFalse();

        const { before, after } = await reconnect(a);
        const landed = {
            kind: 'landed', system: {} as LiveSystem,
            ship: { uuid: a.shipUuid, entity: hull, planetId: SYNTHETIC.planets.port },
        } as ClientState;
        const fleet = new FleetLedger();
        // What game_session's identity subscription does on the change.
        expect(restampHeldFleet(landed, fleet, before, after)).toBe(1);
        expect(hull.components.get(ControlledByComponent)?.peerId).toBe(after);
        expect(hull.components.get(MultiplayerData)?.owner).toBe(after);
        await step(120);

        // Lift-off: THE insertion sequence the client uses, stamping the
        // current connection's uuid.
        const gameData = await getSyntheticGameData();
        await insertPlayerAndFleet({
            bridge: {
                addEntity: async (uuid, entity) => a.client.addEntity(uuid, entity),
            },
            playerUuid: a.shipUuid, player: hull,
            escorts: [], ownerUuid: a.communicator.uuid,
            baseSlot: 0, mintUuid: v4, getShip: id => gameData.data.Ship.get(id),
        });
        const liftedAt = relay.tick;
        await step(600);
        await archive.update();

        expectInLockstep(a, liftedAt);
        expectInLockstep(b, liftedAt);
        const expected = { owner: after, controller: after };
        expect(stamps(archive.archiveWorld, a.shipUuid)).toEqual(expected);
        expect(stamps(a.world, a.shipUuid)).toEqual(expected);
        expect(stamps(b.world, a.shipUuid)).toEqual(expected);
    }, 120_000);

    it('waits for the old copy to leave a room whose server has not noticed the old socket died', async () => {
        const a = await makePeer('a', 100);
        await addOwnedShip(a, 'escort a', 150);
        await step(5);
        const b = await makePeer('b', -100);
        await step(240);

        // A half-open drop: the client gives up on its socket, but the
        // close never reaches the server, which still has the OLD uuid in
        // the room — with the ship it owns.
        const dead = a.socket.webSocket;
        const close = dead.close.bind(dead);
        dead.close = () => undefined;
        const { before, after } = await reconnect(a);
        await step(300);
        await archive.update();
        // Held, not collided and not duplicated: the room still has the old
        // copy (one entity, the old owner), nobody was refused, and nobody
        // desynced.
        expect(desyncs).toEqual([]);
        const old = { owner: before, controller: before };
        expect(stamps(archive.archiveWorld, a.shipUuid)).toEqual(old);
        expect(stamps(a.world, a.shipUuid)).toEqual(old);
        expect(stamps(b.world, a.shipUuid)).toEqual(old);
        expect(stamps(archive.archiveWorld, 'escort a')?.owner).toBe(before);

        // The server notices (its keepalive would): removePeer for the old
        // uuid, and the held re-insertion goes in.
        close();
        await until(() => !relay['roomPeers']().has(before), 'the old socket gone');
        const noticedAt = relay.tick;
        await step(600);
        await archive.update();

        expectInLockstep(a, noticedAt);
        expectInLockstep(b, noticedAt);
        const expected = { owner: after, controller: after };
        expect(stamps(archive.archiveWorld, a.shipUuid)).toEqual(expected);
        expect(stamps(a.world, a.shipUuid)).toEqual(expected);
        expect(stamps(b.world, a.shipUuid)).toEqual(expected);
        const owned = { owner: after, controller: undefined };
        expect(stamps(archive.archiveWorld, 'escort a')).toEqual(owned);
        expect(stamps(b.world, 'escort a')).toEqual(owned);
    }, 120_000);

    describe('refused insertions are not silent', () => {
        function refusalsAt(peer: Peer) {
            const notices: { uuid: string, peer: string, reason: string }[] = [];
            peer.room.messages.subscribe(({ message }) => {
                const unwrapped = unwrapRollbackMessage(message);
                if (unwrapped?.kind === 'inputRefused') {
                    notices.push(unwrapped);
                }
            });
            return notices;
        }

        it('tells the sender, exactly once, and logs it once', async () => {
            const a = await makePeer('a', 100);
            const b = await makePeer('b', -100);
            const atA = refusalsAt(a);
            const atB = refusalsAt(b);
            await step(60);
            const warn = spyOn(console, 'warn').and.callThrough();
            // An insertion declaring another peer as its owner: the
            // ownership rule refuses it on every world (Trust model 5).
            const forged = await makePlayerShip(a.world, 'mallory', 300);
            await a.client.addEntity('forged', forged);
            await step(240);
            await archive.update();

            expect(atA.map(notice => notice.uuid)).toEqual(['forged']);
            expect(atA[0]!.peer).toBe(a.communicator.uuid!);
            expect(atA[0]!.reason).toContain('mallory');
            expect(atB).toEqual([]);
            const lines = (needle: string) => warn.calls.allArgs()
                .filter(args => String(args[0]).includes(needle)).length;
            expect(lines(`Refused ${a.communicator.uuid}'s addEntity of forged`))
                .withContext('the relay\'s log line').toBe(1);
            expect(lines('The room refused this peer\'s addEntity of forged'))
                .withContext('the peer\'s log line').toBe(1);
            // Nothing for a re-entry to fix: the forged owner was never
            // this peer's, so it stays refused and nobody desyncs.
            expect(a.host.status().identityRecoveryFailed).toBeUndefined();
            expect(desyncs).toEqual([]);
        }, 120_000);

        it('re-enters on a refusal a bounded number of times, then reports the failure', async () => {
            // A worker that never learns its new uuid (the identity
            // forwarding broken): its insertions after a reconnect go out
            // stamped with the OLD id and are refused, every time.
            const a = await makePeer('a', 100, { forwardIdentity: false });
            const b = await makePeer('b', -100);
            const atA = refusalsAt(a);
            await step(120);
            await reconnect(a);
            await step(60);
            const escort = await makePlayerShip(a.world, a.communicator.uuid!, 200);
            escort.components.delete(ControlledByComponent);
            // Stamped by the worker's (stale) identity, as a worker-side
            // spawn would be.
            escort.components.set(MultiplayerData,
                { owner: a.world.resources.get(CommunicatorResource)!.uuid! });
            await a.client.addEntity('escort a', escort);
            for (let i = 0; i < 20 && !a.host.status().identityRecoveryFailed; i++) {
                await step(120);
            }
            expect(a.host.status().identityRecoveryFailed).toBeTrue();
            const refused = atA.length;
            // The original insertion, then each of the (at most three)
            // re-entries' re-inserted fleet (the ship and the escort).
            expect(refused).toBeGreaterThanOrEqual(4);
            expect(refused).toBeLessThanOrEqual(1 + 3 * 2);
            // And it stops: no further re-entries, no further refusals.
            await step(600);
            expect(atA.length).toBe(refused);
            expect(b.world.entities.has('escort a')).toBeFalse();
        }, 120_000);
    });
});
