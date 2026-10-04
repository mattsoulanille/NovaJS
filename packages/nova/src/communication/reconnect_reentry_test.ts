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
import {
    arrive, beginTransit, claimSystem, ClientState, ClientStateSlot, enterGame,
    liveSystem, LiveSystem,
} from '../client/client_state.js';
import { insertPlayerAndFleet } from '../client/fleet_insertion.js';
import { FleetLedger } from '../client/fleet_ledger.js';
import { restampHeldFleet } from '../client/identity.js';
import { freezeOnResyncFailure } from '../client/resync_failure.js';
import { resetWarnThrottle } from '../common/log_throttle.js';
import { connectUrlWithVersion } from '../common/version_handshake.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { DeathAIComponent, FormationComponent } from '../nova_plugin/npc/index.js';
import {
    ControlledByComponent, MissionShipComponent, NO_DEAL, PlayerEscortComponent,
} from '../nova_plugin/player/index.js';
import { DeathEvent, makeShip } from '../nova_plugin/ship/index.js';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { applySimulationFrame } from './apply_simulation_frame.js';
import { CommunicatorMessage, MessageType } from './communicator_message.js';
import { InputRecord, SimulationInput } from './simulation_input.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { CommunicatorClient } from './communicator_client.js';
import { CommunicatorServer } from './communicator_server.js';
import { MultiRoom } from './multi_room_communicator.js';
import { unwrapRollbackMessage, wrapRollbackMessage } from './rollback_protocol.js';
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
function workerView(room: Communicator, forwardIdentity: boolean | IdentityGate):
    WorkerRoomCommunicator {
    const worker = new WorkerRoomCommunicator(
        (message, destination) => room.sendMessage(message, destination),
        workerRoomState(room));
    forwardRoomToWorker(room, {
        receiveRoomMessage: (source, message) =>
            worker.receiveMessage(source, message),
        updateRoomState: state => {
            if ('uuid' in state) {
                if (forwardIdentity === false) {
                    return;
                }
                if (forwardIdentity instanceof IdentityGate
                    && forwardIdentity.hold(() => worker.updateRoomState(state))) {
                    return;
                }
            }
            worker.updateRoomState(state);
        },
    });
    return worker;
}

/** Holds identity updates back while closed: a worker whose forwarded
 * identity lags the socket's. */
class IdentityGate {
    private held: (() => void)[] = [];
    closed = false;
    hold(update: () => void): boolean {
        if (!this.closed) {
            return false;
        }
        this.held.push(update);
        return true;
    }
    open() {
        this.closed = false;
        for (const update of this.held.splice(0)) {
            update();
        }
    }
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
    let serverRoom: Communicator;
    /** Display mirrors pumped on every step (mirror below). */
    let pumps: (() => void)[];

    async function startServer(listenPort = 0) {
        httpServer = http.createServer();
        channel = new SocketChannelServer({
            server: httpServer, buildVersion: BUILD, warn: () => undefined,
            timeout: 600_000,
        });
        await new Promise<void>(resolve =>
            httpServer.listen(listenPort, () => resolve()));
        port = (httpServer.address() as AddressInfo).port;
        serverRoom = new MultiRoom(new CommunicatorServer(channel))
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
        pumps = [];
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
        /** The simulation's view of the room (the browser worker's). */
        worker: WorkerRoomCommunicator;
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
        { forwardIdentity = true, hostOptions = {} }: {
            forwardIdentity?: boolean | IdentityGate,
            hostOptions?: ConstructorParameters<typeof SimulationBridgeHost>[2],
        } = {}): Promise<Peer> {
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
        const worker = workerView(room, forwardIdentity);
        world.resources.set(CommunicatorResource, worker);
        const host = new SimulationBridgeHost(world, gameData, hostOptions);
        const serializer = world.resources.get(SerializerResource)!;
        const client = new SimulationBridgeClient(host, serializer);
        expect(await host.joinRoom()).toBeTrue();
        const shipUuid = `ship ${name}`;
        await client.addEntity(shipUuid,
            await makePlayerShip(world, communicator.uuid!, x));
        const peer = {
            name, socket, communicator, room, worker, world, host, client, shipUuid,
        };
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
            for (const pump of pumps) {
                pump();
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
    function expectInLockstep(peer: Peer, fromTick: number,
        { convictionsFrom = 0 } = {}) {
        expect(desyncs.filter(d => d.tick >= convictionsFrom)
            .map(d => `tick ${d.tick}: ${d.convicted.join()}`)).toEqual([]);
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

    /** A hired escort of the peer's player ship, stamped the way
     * fleet_insertion.ts buildHiredEscort stamps one: owned, marked, in
     * formation, and removed on death like any NPC. Part of the FLEET
     * (peer_departure.ts). */
    async function addEscort(peer: Peer, uuid: string, x: number, slot = 0) {
        const ship = await makePlayerShip(peer.world, peer.communicator.uuid!, x);
        ship.components.delete(ControlledByComponent);
        ship.components.set(PlayerEscortComponent, {
            player: peer.shipUuid, parent: peer.shipUuid, provenance: 'hired',
            deal: NO_DEAL,
        });
        ship.components.set(FormationComponent, { leader: peer.shipUuid, slot });
        ship.components.set(DeathAIComponent, undefined);
        await peer.client.addEntity(uuid, ship);
    }

    /** A mission ship the peer's mission spawned at system entry
     * (fleet_insertion.ts): owned, and tethered to the player ship
     * (untethered: no mission to hold, only the owner's presence). */
    async function addMissionShip(peer: Peer, uuid: string, x: number) {
        const ship = await makePlayerShip(peer.world, peer.communicator.uuid!, x);
        ship.components.delete(ControlledByComponent);
        ship.components.set(MissionShipComponent, {
            mission: 'synthetic:mission', owner: peer.shipUuid, untethered: true,
        });
        await peer.client.addEntity(uuid, ship);
    }

    /** Server-authored inputs, exactly as the relay authors removePeer:
     * logged and broadcast for the next tick. Exempt from ownership (Trust
     * model item 5), so they can do to a peer's ship what the room's
     * simulation might while that peer is away. */
    function serverInputs(inputs: SimulationInput[]) {
        const record: InputRecord = {
            peerId: 'server', tick: relay.tick + 1, inputs,
        };
        (relay as unknown as { log: InputRecord[] }).log.push(record);
        serverRoom.sendMessage(wrapRollbackMessage({ kind: 'inputs', record }));
    }

    /** A half-open drop: neither direction of the socket carries anything
     * any more, and its close never reaches the server, which still holds
     * the connection. Returns the real close. */
    function halfOpen(peer: Peer): () => void {
        const dead = peer.socket.webSocket;
        const close = dead.close.bind(dead);
        dead.close = () => undefined;
        dead.send = () => undefined;
        return close;
    }

    /** The client's display world and fleet ledger, fed by the peer's
     * frames exactly as client/frame_pump.ts feeds them (game_session.ts
     * notes deaths and dockings from the frame's events first). */
    function mirror(peer: Peer) {
        const display = new World('display');
        const serializer = peer.world.resources.get(SerializerResource)!;
        const fleet = new FleetLedger();
        pumps.push(() => {
            const frame = peer.client.snapshot();
            for (const event of frame.events) {
                if (event.name === DeathEvent.name) {
                    for (const uuid of event.entityUuids ?? []) {
                        fleet.noteDeath(uuid);
                    }
                }
            }
            applySimulationFrame(frame, serializer, display, {
                onRemove: (uuid, entity) =>
                    fleet.noteRemoved(uuid, entity, peer.shipUuid, serializer),
            });
            for (const [uuid] of frame.added) {
                fleet.escortReturned(uuid);
            }
        });
        return { display, fleet };
    }

    it('re-enters the room under the new uuid with zero desyncs, a second peer converging', async () => {
        const a = await makePeer('a', 100);
        await addEscort(a, 'escort a', 150);
        await addOwnedShip(a, 'npc a', 400);
        await addMissionShip(a, 'mission a', 450);
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
        // The clean close's removePeer DISOWNED the rest (the maintainer's
        // ruling): the room kept them as world ships, and the re-entry left
        // them that way rather than reclaiming them.
        const disowned = { owner: undefined, controller: undefined };
        for (const uuid of ['npc a', 'mission a']) {
            for (const [where, world] of [['archive', archive.archiveWorld],
                ['a', a.world], ['b', b.world]] as const) {
                expect(stamps(world, uuid)).withContext(`${uuid} on ${where}`)
                    .toEqual(disowned);
            }
        }
        // The mission ship's tether resumed with its owner's ship back
        // under the same uuid.
        expect(archive.archiveWorld!.entities.get('mission a')!.components
            .get(MissionShipComponent)?.ownerDisconnected).toBeUndefined();
        // b's own ship never moved owners.
        expect(stamps(archive.archiveWorld, b.shipUuid)).toEqual(
            { owner: b.communicator.uuid, controller: b.communicator.uuid });
    }, 120_000);

    it('re-enters a RESTARTED server, which has no memory of either peer', async () => {
        const a = await makePeer('a', 100);
        await addEscort(a, 'escort a', 150);
        await addOwnedShip(a, 'npc a', 400);
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
        // A room on a NEW timeline never knew the old connection, so
        // nothing was disowned: the rest of what a owns comes back too.
        expect(stamps(archive.archiveWorld, 'npc a')).toEqual(owned);
        expect(stamps(b.world, 'npc a')).toEqual(owned);
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

    it('without a token, waits for the old copy to leave a room whose server has not noticed the old socket died', async () => {
        const a = await makePeer('a', 100);
        await addEscort(a, 'escort a', 150);
        await step(5);
        const b = await makePeer('b', -100);
        await step(240);

        // A half-open drop: the client gives up on its socket, but the
        // close never reaches the server, which still has the OLD uuid in
        // the room — with the ship it owns. And no token to present (the
        // keepalive path every pre-token build took).
        const close = halfOpen(a);
        a.communicator['reconnectToken'] = undefined;
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

    it('with its token, retires the half-open old connection at once: no wait, zero desyncs, a second peer converging', async () => {
        const a = await makePeer('a', 100);
        await addEscort(a, 'escort a', 150);
        await step(5);
        const b = await makePeer('b', -100);
        await step(240);

        halfOpen(a);
        const { before, after } = await reconnect(a);
        // The old peer left the room on the token alone — the socket is
        // still open as far as the server's keepalive knows.
        await until(() => !relay['roomPeers']().has(before),
            'the old connection retired', 2_000);
        expect(channel.clients.has(before)).toBeFalse();
        const retiredAt = relay.tick;
        await step(120);
        await archive.update();
        // The fleet is back, well inside the keepalive's minute.
        const expected = { owner: after, controller: after };
        expect(stamps(archive.archiveWorld, a.shipUuid)).toEqual(expected);
        expect(stamps(archive.archiveWorld, 'escort a'))
            .toEqual({ owner: after, controller: undefined });
        await step(480);
        await archive.update();

        expectInLockstep(a, retiredAt);
        expectInLockstep(b, retiredAt);
        expect(stamps(b.world, a.shipUuid)).toEqual(expected);
        expect(stamps(a.world, a.shipUuid)).toEqual(expected);
        expect(stamps(b.world, 'escort a'))
            .toEqual({ owner: after, controller: undefined });
        // Exactly one removePeer for the old connection, on one tick.
        const removals = relay.inputLog.filter(record => record.inputs.some(
            input => input.kind === 'removePeer' && input.peerId === before));
        expect(removals.length).toBe(1);
    }, 120_000);

    it('removes a departed peer\'s player ship and escorts, and disowns the rest, on every world', async () => {
        const a = await makePeer('a', 100);
        await addEscort(a, 'escort a', 150);
        await addOwnedShip(a, 'npc a', 400);
        await addMissionShip(a, 'mission a', 450);
        const b = await makePeer('b', -100);
        await step(240);
        for (const uuid of [a.shipUuid, 'escort a', 'npc a', 'mission a']) {
            expect(archive.archiveWorld!.entities.has(uuid)).withContext(uuid)
                .toBeTrue();
        }

        // a leaves for good.
        const gone = a.communicator.uuid!;
        peers.splice(peers.indexOf(a), 1);
        a.socket.disconnect();
        await until(() => !relay['roomPeers']().has(gone), 'a gone');
        const leftAt = relay.tick;
        await step(600);
        await archive.update();

        expectInLockstep(b, leftAt);
        for (const [where, world] of [['archive', archive.archiveWorld],
            ['b', b.world]] as const) {
            expect(world!.entities.has(a.shipUuid)).withContext(where).toBeFalse();
            expect(world!.entities.has('escort a')).withContext(where).toBeFalse();
            for (const uuid of ['npc a', 'mission a']) {
                expect(stamps(world, uuid)).withContext(`${uuid} on ${where}`)
                    .toEqual({ owner: undefined, controller: undefined });
            }
            // Kept by the owner-absence despawn, flagged.
            expect(world!.entities.get('mission a')!.components
                .get(MissionShipComponent)?.ownerDisconnected)
                .withContext(where).toBeTrue();
        }
    }, 120_000);

    it('returns the fleet un-destroyed: ships gone after the disconnect come back, the ledger counts no loss or death, and one gone before it stays gone', async () => {
        const a = await makePeer('a', 100);
        await addEscort(a, 'escort 0', 130, 0);
        await addEscort(a, 'escort 1', 150, 1);
        await addEscort(a, 'escort 2', 170, 2);
        await addOwnedShip(a, 'npc a', 400);
        await addOwnedShip(a, 'npc b', 450);
        const b = await makePeer('b', -100);
        await step(240);

        // BEFORE the disconnect: escort 0 leaves the fleet for good, on
        // every world (its owner's own removal; done before the ledger is
        // watching, since a bare removal is the ledger's ordinary
        // unexplained loss, ruling #148 — nothing to do with a reconnect).
        a.client.removeEntity('escort 0');
        await step(60);
        expect(archive.archiveWorld!.entities.has('escort 0')).toBeFalse();
        const { display, fleet } = mirror(a);
        await step(60);
        for (const uuid of ['escort 1', 'escort 2']) {
            expect(display.entities.has(uuid)).withContext(uuid).toBeTrue();
        }

        // The connection drops, half-open, and the client notices.
        halfOpen(a);
        a.socket.disconnect();
        // While a is away, the room loses escort 1 (to the room's own
        // simulation, which a never hears of: a server-stamped removal
        // stands in for its destruction there)...
        serverInputs([{ kind: 'removeEntity', uuid: 'escort 1' }]);
        // (One of the ships it merely owns goes the same way: NOT fleet,
        // so NOT returned — the room's verdict on a disowned ship stands.)
        serverInputs([{ kind: 'removeEntity', uuid: 'npc a' }]);
        // ...and a's world, playing on alone, watches escort 2 die (a
        // real DeathEvent; the ledger notes it).
        a.world.emit(DeathEvent, a.world.resources.get(TimeResource)!,
            ['escort 2']);
        await step(120);
        expect(archive.archiveWorld!.entities.has('escort 1')).toBeFalse();
        expect(a.world.entities.has('escort 1')).toBeTrue();
        expect(a.world.entities.has('escort 2')).toBeFalse();
        expect(display.entities.has('escort 2')).toBeFalse();

        const { after } = await reconnect(a);
        const rejoinedAt = relay.tick;
        await step(600);
        await archive.update();

        expectInLockstep(a, rejoinedAt);
        expectInLockstep(b, rejoinedAt);
        const owned = { owner: after, controller: undefined };
        for (const uuid of ['escort 1', 'escort 2']) {
            for (const [where, world] of [['archive', archive.archiveWorld],
                ['a', a.world], ['b', b.world]] as const) {
                expect(stamps(world, uuid)).withContext(`${uuid} on ${where}`)
                    .toEqual(owned);
            }
            expect(display.entities.has(uuid)).withContext(uuid).toBeTrue();
        }
        for (const [where, world] of [['archive', archive.archiveWorld],
            ['a', a.world], ['b', b.world]] as const) {
            expect(world!.entities.has('escort 0')).withContext(where).toBeFalse();
            expect(world!.entities.has('npc a')).withContext(where).toBeFalse();
            // The one the room kept is a world ship now, not reclaimed.
            expect(stamps(world, 'npc b')).withContext(where)
                .toEqual({ owner: undefined, controller: undefined });
        }
        // Neither return is booked as a loss to respawn (a duplicate at the
        // next system entry) nor kept as a death (which would explain away
        // a later, real loss).
        expect(fleet.lost.map(row => row.uuid)).toEqual([]);
        const deaths = (fleet as unknown as { recentDeaths: Set<string> })
            .recentDeaths;
        expect(deaths.has('escort 1')).toBeFalse();
        expect(deaths.has('escort 2')).toBeFalse();
    }, 120_000);

    describe('the reconnect token', () => {
        interface Connection {
            name: string;
            socket: SocketChannelClient;
            communicator: CommunicatorClient;
            room: Communicator;
            /** Every communicator frame this socket received. */
            frames: unknown[];
        }

        async function connect(name: string): Promise<Connection> {
            const socket = new SocketChannelClient({
                webSocketFactory: () => new WebSocket(
                    connectUrlWithVersion(`ws://127.0.0.1:${port}`, BUILD)),
                warn: () => undefined,
                timeout: 600_000,
            });
            sockets.push(socket);
            const frames: unknown[] = [];
            socket.message.subscribe(frame => frames.push(frame));
            const communicator = new CommunicatorClient(socket);
            const room = new MultiRoom(communicator).join(SYSTEM);
            await until(() => communicator.uuid !== undefined
                && room.peers.current.value.has(communicator.uuid),
                `${name} in the room`);
            return { name, socket, communicator, room, frames };
        }

        const tokenOf = (connection: Connection) =>
            connection.communicator['reconnectToken'] as string | undefined;

        /** Reconnects over a half-open drop, presenting `token` (the
         * connection's own by default). */
        async function reconnectWith(connection: Connection, token?: string) {
            const before = connection.communicator.uuid!;
            const dead = connection.socket.webSocket;
            dead.close = () => undefined;
            dead.send = () => undefined;
            if (token !== undefined) {
                connection.communicator['reconnectToken'] = token;
            }
            connection.socket.reconnect();
            await until(() => connection.communicator.uuid !== before
                && connection.room.peers.current.value.has(
                    connection.communicator.uuid!),
                `${connection.name} back under a new uuid`);
            return { before, after: connection.communicator.uuid! };
        }

        /** Let the server handle whatever is in flight. */
        const settle = () => sleep(100);

        const serverPeers = () => serverRoom.peers.current.value;

        it('is issued per connection, fresh each time, and reaches no one else', async () => {
            const a = await connect('a');
            const b = await connect('b');
            const log = spyOn(console, 'log').and.callThrough();
            const warn = spyOn(console, 'warn').and.callThrough();
            const error = spyOn(console, 'error').and.callThrough();
            const first = tokenOf(a)!;
            expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits, base64url
            expect(tokenOf(b)).not.toBe(first);
            await reconnectWith(a);
            const second = tokenOf(a)!;
            expect(second).not.toBe(first);
            await settle();

            const carries = (frames: unknown[], token: string) =>
                frames.some(frame => JSON.stringify(frame,
                    (_key, value) => value instanceof Set ? [...value] : value)
                    .includes(token));
            expect(carries(b.frames, first)).toBeFalse();
            expect(carries(b.frames, second)).toBeFalse();
            expect(carries(a.frames, first)).toBeTrue();
            // Never logged, by the server or the clients.
            const logged = [log, warn, error].some(spy => spy.calls.allArgs()
                .some(args => args.some(arg => String(arg).includes(first)
                    || String(arg).includes(second))));
            expect(logged).toBeFalse();
        }, 30_000);

        it('a wrong token retires nobody: the half-open old connection stays until the server notices', async () => {
            const a = await connect('a');
            const b = await connect('b');
            const { before, after } = await reconnectWith(a,
                'A'.repeat(43));
            await settle();
            expect(serverPeers().has(before)).toBeTrue();
            expect(serverPeers().has(after)).toBeTrue();
            expect(serverPeers().has(b.communicator.uuid!)).toBeTrue();
            expect(channel.clients.has(before)).toBeTrue();
        }, 30_000);

        it('a spent token retires nobody, however often it is replayed', async () => {
            const a = await connect('a');
            const b = await connect('b');
            const spent = tokenOf(a)!;
            const first = await reconnectWith(a);
            await until(() => !serverPeers().has(first.before), 'a retired');
            // Replayed from another fresh connection, and by a itself.
            const c = await connect('c');
            const replayed = await reconnectWith(c, spent);
            const again = await reconnectWith(a, spent);
            await settle();
            expect(serverPeers().has(first.after)).toBeTrue();
            expect(serverPeers().has(again.before)).toBeTrue();
            expect(serverPeers().has(replayed.before)).toBeTrue();
            expect(serverPeers().has(b.communicator.uuid!)).toBeTrue();
        }, 30_000);

        it('another client\'s token, from a connection already speaking, retires nobody and is not spent by it', async () => {
            const b = await connect('b');
            const mallory = await connect('mallory');
            const stolen = tokenOf(b)!;
            mallory.socket.send(CommunicatorMessage.encode({
                type: MessageType.reconnect, token: stolen,
            }));
            await settle();
            expect(serverPeers().has(b.communicator.uuid!)).toBeTrue();
            expect(channel.clients.has(b.communicator.uuid!)).toBeTrue();
            // b's own reconnect still retires its old connection with it.
            const { before } = await reconnectWith(b);
            await until(() => !serverPeers().has(before), 'b\'s old connection retired');
            expect(serverPeers().has(mallory.communicator.uuid!)).toBeTrue();
        }, 30_000);

        it('grants no identity: the presenter gets a NEW uuid, and nothing the old connection owned', async () => {
            const a = await makePeer('a', 100);
            await addEscort(a, 'escort a', 150);
            await step(120);
            halfOpen(a);
            // Detach a's simulation, so nothing re-inserts the fleet: what
            // the token alone does to it is all that is left to see.
            peers.splice(peers.indexOf(a), 1);
            const { before, after } = await reconnect(a);
            await until(() => !relay['roomPeers']().has(before), 'retired');
            await step(60);
            await archive.update();
            expect(after).not.toBe(before);
            expect(archive.archiveWorld!.entities.has(a.shipUuid)).toBeFalse();
            expect(archive.archiveWorld!.entities.has('escort a')).toBeFalse();
            const stampedAfter = [...archive.archiveWorld!.entities.values()]
                .filter(entity => entity.components.get(MultiplayerData)?.owner === after
                    || entity.components.get(ControlledByComponent)?.peerId === after);
            expect(stampedAfter).toEqual([]);
        }, 60_000);
    });

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

        /** An escort stamped by the worker's identity, as a worker-side
         * spawn is: after a reconnect the worker has not followed, the
         * OLD one. */
        async function insertWorkerStampedEscort(peer: Peer) {
            const escort = await makePlayerShip(peer.world, peer.worker.uuid!, 200);
            escort.components.delete(ControlledByComponent);
            await peer.client.addEntity('escort a', escort);
        }

        it('waits for an identity the room knows and the worker has not learned yet, then recovers', async () => {
            // The worker's forwarded identity lags the socket's past the
            // room's refusal of an insertion it made in the gap.
            const gate = new IdentityGate();
            const a = await makePeer('a', 100, { forwardIdentity: gate });
            const b = await makePeer('b', -100);
            const atA = refusalsAt(a);
            await step(120);
            gate.closed = true;
            const { after } = await reconnect(a);
            await insertWorkerStampedEscort(a);
            for (let i = 0; i < 100 && atA.length === 0; i++) {
                await step(10);
            }
            expect(atA.map(notice => notice.peer)).toEqual([after]);
            // Well inside the grace, the worker still waiting.
            await step(60);
            expect(a.host.status().identityRecoveryFailed).toBeUndefined();

            // The identity arrives: its change re-enters, the escort the
            // room refused going back in under the current id.
            gate.open();
            const recoveredAt = relay.tick;
            await step(900);
            await archive.update();

            expect(a.host.status().identityRecoveryFailed).toBeUndefined();
            // (The gap itself may be convicted: the worker played on under
            // an id the room no longer stamps. From the recovery on, none.)
            expectInLockstep(a, recoveredAt + 300,
                { convictionsFrom: recoveredAt + 300 });
            expectInLockstep(b, recoveredAt + 300,
                { convictionsFrom: recoveredAt + 300 });
            const owned = { owner: after, controller: undefined };
            expect(stamps(archive.archiveWorld, 'escort a')).toEqual(owned);
            expect(stamps(b.world, 'escort a')).toEqual(owned);
            expect(stamps(archive.archiveWorld, a.shipUuid))
                .toEqual({ owner: after, controller: after });
        }, 120_000);

        it('reports the failure rather than loop when the worker never learns its identity', async () => {
            // The identity forwarding broken: nothing this worker inserts
            // under the id it has can ever be accepted.
            const a = await makePeer('a', 100, {
                forwardIdentity: false, hostOptions: { identityGraceMs: 300 },
            });
            await makePeer('b', -100);
            const atA = refusalsAt(a);
            await step(120);
            await reconnect(a);
            await step(30);
            await insertWorkerStampedEscort(a);
            for (let i = 0; i < 100 && !a.host.status().identityRecoveryFailed; i++) {
                await step(10);
            }
            expect(a.host.status().identityRecoveryFailed).toBeTrue();
            // One refusal, no re-entry to be refused again — and it stays
            // that way.
            expect(atA.length).toBe(1);
            await step(600);
            expect(atA.length).toBe(1);
        }, 120_000);

        it('ends a never-recoverable identity in #333\'s terminal state, '
            + 'reported exactly once', async () => {
            // Integration of #354 with #333: the identity give-up takes
            // the resync give-up's one terminal path — the host frozen for
            // good, one frame announcing it, and the client's save and
            // `desynced` freeze (client/resync_failure.ts; the Reload
            // dialog on top of it is browser-only) — not a flag of its own.
            const a = await makePeer('a', 100, {
                forwardIdentity: false, hostOptions: { identityGraceMs: 300 },
            });
            await makePeer('b', -100);
            const announced: number[] = [];
            const live = { systemId: SYSTEM } as unknown as LiveSystem;
            const state = new ClientStateSlot();
            state.apply(s => arrive(claimSystem(beginTransit(enterGame(s), {
                kind: 'startup', from: undefined, to: SYSTEM,
                uuid: a.shipUuid, entity: new Entity(),
            }), { systemId: SYSTEM }), live));
            let saves = 0;
            const runtime = {
                state,
                saves: { saveNow: () => { saves++; return true; } },
            } as unknown as Parameters<typeof freezeOnResyncFailure>[0];
            // The frame pump's half (client/frame_pump.ts): a frame that
            // carries `resyncFailed` saves and freezes. (Snapshotted on
            // every step, even once frozen, to count the announcements.)
            pumps.push(() => {
                const frame = a.client.snapshot();
                if (frame.resyncFailed) {
                    announced.push(relay.tick);
                    if (liveSystem(state.state) === live) {
                        freezeOnResyncFailure(runtime, live);
                    }
                }
            });
            await step(120);
            await reconnect(a);
            await step(30);
            await insertWorkerStampedEscort(a);
            for (let i = 0; i < 100 && !a.host.status().identityRecoveryFailed; i++) {
                await step(10);
            }
            expect(a.host.status().identityRecoveryFailed).toBeTrue();
            expect(a.host.status().resyncFailed).toBeTrue();
            expect(a.host.status().joined).toBeFalse();
            const frozenAt = a.host.status().tick;
            await step(600);

            expect(announced.length).withContext('frames announcing it')
                .toBe(1);
            expect(saves).withContext('lost-sync saves').toBe(1);
            expect(state.state.kind).toBe('desynced');
            // Frozen: no stepping, no state sent, no further resync.
            expect(a.host.status().tick).toBe(frozenAt);
            const later = a.host.snapshot();
            expect(later.resyncFailed).toBeUndefined();
            expect(later.added).toEqual([]);
            expect(later.changed).toEqual([]);
            expect(await a.host.resync(true)).toBeFalse();
            expect(a.host.status().tick).toBe(frozenAt);
        }, 120_000);

        it('re-enters on a refusal of an entity it holds under a stale id, at most three times', async () => {
            const a = await makePeer('a', 100);
            await addEscort(a, 'escort a', 150);
            await makePeer('b', -100);
            await step(120);
            const { before, after } = await reconnect(a);
            await step(600);
            expect(stamps(a.world, 'escort a')?.owner).toBe(after);
            const error = spyOn(console, 'error').and.callThrough();
            // A refusal of an escort this world still holds under the old
            // id (as a local application under it that the re-entry
            // missed would leave it): each one re-enters, re-stamped.
            const refuse = () => {
                a.world.entities.get('escort a')!.components.set(
                    MultiplayerData, { owner: before });
                a.worker.receiveMessage('server', wrapRollbackMessage({
                    kind: 'inputRefused', peer: after, tick: relay.tick,
                    uuid: 'escort a', input: 'addEntity',
                    reason: `declares owner ${before}`,
                }));
            };
            for (let attempt = 1; attempt <= 3; attempt++) {
                refuse();
                await step(300);
                // The re-entry rebuilt the world from the room, where the
                // escort is the current connection's.
                expect(stamps(a.world, 'escort a')?.owner)
                    .withContext(`re-entry ${attempt}`).toBe(after);
                expect(a.host.status().identityRecoveryFailed).toBeUndefined();
            }
            refuse();
            await step(30);
            expect(a.host.status().identityRecoveryFailed).toBeTrue();
            expect(error.calls.allArgs().filter(args =>
                String(args[0]).includes('giving up after 3 re-entries')).length)
                .toBe(1);
        }, 120_000);
    });
});
