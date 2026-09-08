import 'jasmine';
import * as http from 'http';
import { AddressInfo } from 'net';
import { firstValueFrom, filter } from 'rxjs';
import { WebSocket as WsClient } from 'ws';
import { connectUrlWithVersion } from '../common/version_handshake.js';
import { CommunicatorClient } from './communicator_client.js';
import { CommunicatorServer } from './communicator_server.js';
import { MultiRoom } from './multi_room_communicator.js';
import { PROTOCOL_VERSION, unwrapRollbackMessage, wrapRollbackMessage } from './rollback_protocol.js';
import { SocketChannelClient } from './socket_channel_client.js';
import { SocketChannelServer, TEXT_FRAME_CLOSE_CODE } from './socket_channel_server.js';
import { AvroWireCodec } from './wire_codec.js';
import { liveWireCodec, liveWireFingerprint } from './wire_schemas.js';

const BUILD = 'binary-wire-build';

/**
 * The live wire end to end, over REAL sockets: a SocketChannelServer
 * and a SocketChannelClient (on Node's WebSocket), the communicator
 * and room layers on both, and rollback-protocol messages crossing
 * between them as Avro binary frames. The spy-based socket specs cover
 * the plumbing with an untyped payload; this one proves the TYPED
 * schema (wire_schemas.ts WireMessageType) carries what the rooms
 * actually send, in both directions, and that the frames are binary.
 */
describe('the binary wire', () => {
    let httpServer: http.Server;
    let channel: SocketChannelServer;
    let baseUrl: string;
    let warnings: string[];
    const clients: SocketChannelClient[] = [];
    const rawSockets: WsClient[] = [];

    beforeEach(async () => {
        warnings = [];
        httpServer = http.createServer();
        channel = new SocketChannelServer({
            server: httpServer, buildVersion: BUILD,
            warn: m => warnings.push(m),
        });
        await new Promise<void>(resolve => httpServer.listen(0, () => resolve()));
        const port = (httpServer.address() as AddressInfo).port;
        baseUrl = `ws://127.0.0.1:${port}`;
    });

    afterEach(async () => {
        for (const client of clients.splice(0)) {
            client.disconnect();
        }
        for (const socket of rawSockets.splice(0)) {
            socket.close();
        }
        channel.wss.close();
        await new Promise<void>(resolve => httpServer.close(() => resolve()));
    });

    /** A client channel on Node's own WebSocket, with the live codec. */
    function connectClient(): { client: SocketChannelClient, frames: unknown[] } {
        const frames: unknown[] = [];
        const client = new SocketChannelClient({
            webSocketFactory: () => {
                const socket = new WebSocket(connectUrlWithVersion(baseUrl, BUILD));
                socket.addEventListener('message', event => frames.push(event.data));
                return socket;
            },
            warn: m => warnings.push(`client: ${m}`),
            timeout: 5000,
        });
        clients.push(client);
        return { client, frames };
    }

    it('the live codec is Avro with a fingerprint', () => {
        const codec = liveWireCodec();
        expect(codec.encoding).toBe('avro');
        expect(liveWireFingerprint()).toMatch(/^[0-9a-f]{16}$/);
        expect((codec as AvroWireCodec).fingerprint).toBe(liveWireFingerprint()!);
    });

    it('carries rollback messages both ways as binary frames', async () => {
        const server = new CommunicatorServer(channel);
        const serverRooms = new MultiRoom(server);
        const serverRoom = serverRooms.join('nova:129');

        const { client, frames } = connectClient();
        const communicator = new CommunicatorClient(client);
        const rooms = new MultiRoom(communicator);
        const room = rooms.join('nova:129');
        // The server admits the socket, assigns a uuid, announces peers.
        await firstValueFrom(room.peers.current.pipe(
            filter(peers => peers.has('server') && peers.size === 2)));
        expect(room.uuid).toBeDefined();

        // Client -> server: a join request, as the bridge would send.
        const atServer = firstValueFrom(serverRoom.messages);
        room.sendMessage(wrapRollbackMessage({
            kind: 'joinRequest', fresh: true, protocol: PROTOCOL_VERSION,
            schema: liveWireFingerprint(),
        }), 'server');
        const received = await atServer;
        expect(received.source).toBe(room.uuid!);
        expect(unwrapRollbackMessage(received.message)).toEqual({
            kind: 'joinRequest', fresh: true, protocol: PROTOCOL_VERSION,
            schema: liveWireFingerprint(),
        });

        // Server -> client: an input record with the numbers JSON loses.
        const atClient = firstValueFrom(room.messages);
        const record = {
            peerId: 'other', tick: 12, seq: 0, inputs: [
                { kind: 'analogControl' as const, heading: -0, throttle: null },
                { kind: 'control' as const, events: [{ action: 'accelerate' as const, state: 'start' as const }] },
            ],
        };
        serverRoom.sendMessage(wrapRollbackMessage({ kind: 'inputs', record }), room.uuid!);
        const relayed = unwrapRollbackMessage((await atClient).message);
        expect(relayed).toEqual({ kind: 'inputs', record });
        const heading = (relayed as { record: { inputs: { heading: number }[] } })
            .record.inputs[0]!.heading;
        expect(Object.is(heading, -0)).toBeTrue();

        // Every frame the client received was binary.
        expect(frames.length).toBeGreaterThan(0);
        expect(frames.every(frame => frame instanceof ArrayBuffer)).toBeTrue();
        // ("Connected" is the client's info log through `warn`.)
        expect(warnings.filter(w => w !== 'client: Connected')).toEqual([]);
    });

    it('drops a message the schema cannot carry, with a warning, and keeps the socket', async () => {
        const server = new CommunicatorServer(channel);
        new MultiRoom(server).join('nova:129');
        const { client } = connectClient();
        const communicator = new CommunicatorClient(client);
        const rooms = new MultiRoom(communicator);
        const room = rooms.join('nova:129');
        await firstValueFrom(room.peers.current.pipe(filter(peers => peers.has('server'))));

        const atServer: unknown[] = [];
        server.messages.subscribe(m => atServer.push(m.message));
        room.sendMessage({ legacy: 'delta-sync message' }, 'server');
        room.sendMessage(wrapRollbackMessage({ kind: 'tickSync', tick: 3 }), 'server');
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(atServer.length).toBe(1);
        expect(warnings.some(w => /client: Not sending a message the avro wire cannot carry/.test(w)))
            .toBeTrue();
        expect(client.connected.value).toBeTrue();
    });

    it('closes a client that speaks the old JSON (text) wire, with the reason', async () => {
        const socket = new WsClient(connectUrlWithVersion(baseUrl, BUILD));
        rawSockets.push(socket);
        await new Promise<void>(resolve => socket.on('open', () => resolve()));
        const closed = new Promise<{ code: number, reason: string }>(resolve =>
            socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
        const gone = firstValueFrom(channel.clientDisconnect);
        socket.send(JSON.stringify({ message: { type: 1, message: { room: 'r', inRoom: true } } }));
        const result = await closed;
        expect(result.code).toBe(TEXT_FRAME_CLOSE_CODE);
        expect(result.reason).toMatch(/text frames are not accepted.*Avro/);
        await gone;
        expect(channel.clients.size).toBe(0);
    });
});
