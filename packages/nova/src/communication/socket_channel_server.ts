import { isLeft } from "fp-ts/lib/Either.js";
import https from "https";
import http from "http";
import { BehaviorSubject, Subject } from "rxjs";
import { v4 } from "uuid";
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";
import { ChannelServer, MessageWithSourceType } from "./channel.js";
import { SocketMessage } from "./socket_message.js";
import {
    shouldAdmitClient, truncateCloseReason, VERSION_MISMATCH_CLOSE_CODE,
    versionFromConnectUrl,
} from "../common/version_handshake.js";
import { decodeWire, WireCodec } from "./wire_codec.js";
import { liveWireCodec } from "./wire_schemas.js";

interface Client {
    socket: NodeWebSocket;
    keepaliveTimeout?: NodeJS.Timeout;
}

/**
 * The largest frame a client may send. ws's default is 100 MiB, fully
 * buffered and decoded per frame. The largest legitimate
 * client->server message is a desync dump (32 checkpoint snapshots of
 * a busy system: low single-digit MiB); DesyncRecorder caps what it
 * writes at the same figure. ws closes a frame over this with 1009.
 */
export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

/**
 * The close code for a TEXT frame. The wire is binary (Avro, protocol
 * 7): a text frame can only come from a client speaking the JSON wire
 * of an older build, and there is no fallback — a JSON message would
 * have to be re-validated against a schema the sender never derived.
 * 1003 is WebSocket's "unsupported data"; the reason says why.
 */
export const TEXT_FRAME_CLOSE_CODE = 1003;
export const TEXT_FRAME_CLOSE_REASON =
    'text frames are not accepted: this server speaks the binary (Avro) wire';

/** The bytes of a ws message, whatever ws buffered it as. */
export function rawDataBytes(data: string | Buffer | ArrayBuffer | Buffer[]): Uint8Array {
    if (typeof data === 'string') {
        return new TextEncoder().encode(data);
    }
    if (Array.isArray(data)) {
        return Buffer.concat(data);
    }
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }
    return data;
}

export class SocketChannelServer implements ChannelServer {
    readonly message = new Subject<MessageWithSourceType<unknown>>();
    readonly clientConnect = new Subject<string>();
    readonly clientDisconnect = new Subject<string>();
    readonly connected = new BehaviorSubject(true); // Server is always connected

    private clientMap = new Map<string, Client>();
    readonly wss: WebSocketServer;
    private warn: (m: string) => void = console.warn;
    /** How socket messages become frames; the live wire unless a test
     * supplies its own. */
    private readonly codec: WireCodec;

    // Send a ping if a packet hasn't been received in this long
    // If the ping doesn't get back in this much time, disconnect them.
    readonly timeout: number;

    /**
     * This server's build stamp. When set, a connecting client must
     * announce the same stamp or it is refused before it is admitted.
     *
     * Optional because the socket layer is also used by tests and tools
     * that have no build identity; when it is undefined the check is
     * skipped entirely. Production always sets it (`server.ts`).
     */
    private readonly buildVersion?: string;

    constructor({ server, warn, wss, timeout, buildVersion, codec }: {
        server?: http.Server | https.Server,
        warn?: ((m: string) => void),
        wss?: WebSocketServer, timeout?: number,
        buildVersion?: string,
        codec?: WireCodec,
    }) {

        if (warn) {
            this.warn = warn;
        }

        this.buildVersion = buildVersion;
        this.codec = codec ?? liveWireCodec();

        if (wss) {
            this.wss = wss;
        }
        else if (server) {
            this.wss = new WebSocketServer({
                server: server,
                maxPayload: MAX_PAYLOAD_BYTES,
            });
        }
        else {
            throw new Error("httpsServer or wss must be defined");
        }

        if (timeout) {
            this.timeout = timeout;
        } else {
            this.timeout = 30000;
        }

        this.wss.on("connection", this.onConnect.bind(this));
    }

    get clients() {
        return new Set(this.clientMap.keys());
    }

    private sendRawIfOpen(destination: string,
        socketMessage: SocketMessage): boolean {

        const client = this.clientMap.get(destination);
        if (!client) {
            this.warn(`No such client ${destination}`);
        } else if (client.socket.readyState === WebSocket.OPEN) {
            let frame: Uint8Array;
            try {
                frame = this.codec.encode(SocketMessage.encode(socketMessage));
            } catch (error) {
                // A message the wire schema does not admit is a bug in
                // the sender, not a reason to drop the client.
                this.warn(`Not sending a message to ${destination} the `
                    + `${this.codec.encoding} wire cannot carry: ${String(error)}`);
                return false;
            }
            // A Uint8Array goes as a BINARY frame.
            client.socket.send(frame);
            return true;
        }
        return false;
    }

    send(destination: string, message: unknown) {
        return this.sendRawIfOpen(destination, { message });
    }

    private resetClientTimeout(uuid: string) {
        const client = this.clientMap.get(uuid);
        if (!client) {
            throw new Error(`Tried to reset keepalive timeout`
                + ` of nonexistant client ${uuid}`);
        }

        if (client.keepaliveTimeout) {
            clearTimeout(client.keepaliveTimeout);
        }

        client.keepaliveTimeout = setTimeout(() => {
            // Send the client a ping
            this.sendRawIfOpen(uuid, { ping: true });
            client.keepaliveTimeout = setTimeout(() => {
                // Remove the client if it hasn't responded. Closing the
                // socket is part of removing it: forgetting the map
                // entry alone left the TCP connection open with no
                // listeners at all — a leaked descriptor per keepalive
                // cycle on a flaky link, and a receiver error on that
                // orphan then threw ERR_UNHANDLED_ERROR.
                this.handleClientClose(uuid);
            }, this.timeout);
        }, this.timeout);
    }

    /**
     * Every socket needs an `error` listener for its whole life: ws's
     * receiver emits `error` on the WebSocket for protocol violations
     * (invalid UTF-8 in a text frame, reserved bits, a frame over
     * maxPayload), and an EventEmitter with no `error` listener throws
     * — an uncaught exception from a network peer's bytes. ws closes
     * the socket itself after such an error, so the `close` listener
     * does the cleanup; this one only reports.
     */
    private guardSocketErrors(webSocket: NodeWebSocket, who: string) {
        webSocket.on("error", (error: unknown) => {
            this.warn(`Socket error from ${who}: ${String(error)}`);
        });
    }

    /**
     * Handles when a client first connects.
     *
     * `request` is the HTTP upgrade request `ws` hands to the `connection`
     * listener; the client's build stamp rides on its query string.
     */
    private onConnect(webSocket: NodeWebSocket,
        request?: http.IncomingMessage) {

        // THE VERSION GATE. Everything below this block admits the client:
        // it lands in `clientMap` and `clientConnect` fires, which is what
        // lets it join a room. A build-mismatched client must never get
        // that far -- once it is in a room with updated peers it steps a
        // different simulation and fails the desync hash, and the rollback
        // relay can then only report the damage after the fact. So the
        // refusal happens here, before any client state exists.
        if (this.buildVersion !== undefined) {
            const clientVersion = versionFromConnectUrl(request?.url);
            const decision = shouldAdmitClient(this.buildVersion, clientVersion);
            if (!decision.admit) {
                this.warn(`Refusing websocket connection: ${decision.reason}`);
                // A refused socket still has a close frame in flight
                // and a receiver that can error while it does.
                this.guardSocketErrors(webSocket, 'refused client');
                // The client reads this code and reloads itself to pick up
                // the current bundle. The reason carries the server's stamp
                // so a refusal is diagnosable from a browser console alone.
                webSocket.close(VERSION_MISMATCH_CLOSE_CODE,
                    truncateCloseReason(decision.reason));
                return;
            }
        }

        const clientUUID = v4();
        this.guardSocketErrors(webSocket, clientUUID);
        // This uuid is used only for communication and
        // has nothing to do with the game engine's uuids
        const client: Client = {
            socket: webSocket,
        };
        this.clientMap.set(clientUUID, client);
        this.resetClientTimeout(clientUUID);

        if (webSocket.readyState === WebSocket.CONNECTING) {
            webSocket.on("open", () => {
                this.clientConnect.next(clientUUID);
            });
        } else if (webSocket.readyState === WebSocket.OPEN) {
            this.clientConnect.next(clientUUID);
        } else {
            const state = webSocket.readyState === WebSocket.CLOSING
                ? "CLOSING" : "CLOSED";
            throw new Error(`Expected socket to be in CONNECTING or CONNECTED state but it was ${state}`);
        }

        webSocket.on("message", this.handleMessageFromClient.bind(this, clientUUID));
        webSocket.on("close", this.handleClientClose.bind(this, clientUUID));
    }

    // Handles messages received from clients. Forwards messages to their destination.
    //
    // ws invokes this synchronously from the socket's data handler, so
    // anything thrown here is an uncaught exception: every failure
    // below drops the message instead.
    private handleMessageFromClient(clientUUID: string,
        serialized: string | Buffer | ArrayBuffer | Buffer[], isBinary?: boolean) {
        const client = this.clientMap.get(clientUUID);
        if (!client) {
            // A frame that raced the client's removal.
            this.warn(`Dropping message from departed client ${clientUUID}`);
            return;
        }
        this.resetClientTimeout(clientUUID);

        // ws hands a text frame over with `isBinary` false (its data
        // is still a Buffer). There is no text fallback: close, with
        // the reason, so the mismatch is diagnosable from either end.
        if (isBinary === false || typeof serialized === 'string') {
            this.warn(`Closing client ${clientUUID}: it sent a text frame; `
                + TEXT_FRAME_CLOSE_REASON);
            client.socket.close(TEXT_FRAME_CLOSE_CODE,
                truncateCloseReason(TEXT_FRAME_CLOSE_REASON));
            return;
        }

        const maybeSocketMessage = decodeWire(this.codec, SocketMessage,
            rawDataBytes(serialized));
        if (isLeft(maybeSocketMessage)) {
            this.warn(`Dropping undecodable message from client ${clientUUID}: `
                + (maybeSocketMessage.left[0]?.message ?? 'not a socket message'));
            return;
        }

        const socketMessage = maybeSocketMessage.right;
        if (socketMessage.pong) {
            // We already reset the client timeout above.
            // No need to do anything if it's a pong.
            return;
        }

        if (socketMessage.ping) {
            this.sendRawIfOpen(clientUUID, { pong: true });
            return;
        }

        if (!socketMessage.message) {
            this.warn(`Message from ${clientUUID} had no data`);
            return;
        }

        this.message.next({
            message: socketMessage.message,
            source: clientUUID,
        });
    }

    /**
     * Removes a client: on its socket closing, or on a keepalive
     * timeout (in which case the socket is still open and is torn down
     * here). Idempotent — a close event can trail a timeout removal.
     */
    private handleClientClose(clientUUID: string) {
        const client = this.clientMap.get(clientUUID);
        if (!client) {
            return;
        }

        if (client.keepaliveTimeout !== undefined) {
            clearTimeout(client.keepaliveTimeout);
        }

        client.socket.removeAllListeners();
        // Listenerless sockets throw on a late receiver error; keep a
        // sink until the socket is gone for good.
        client.socket.on("error", () => { });
        if (client.socket.readyState !== WebSocket.CLOSED) {
            client.socket.terminate();
        }
        this.clientMap.delete(clientUUID);
        this.clientDisconnect.next(clientUUID);
    }
}
