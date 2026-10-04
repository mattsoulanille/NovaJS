import { isRight } from "fp-ts/lib/Either.js";
import { BehaviorSubject, Subject } from "rxjs";
import { ChannelClient } from "./channel.js";
import { SocketMessage } from "./socket_message.js";
import {
    connectUrlWithVersion, VERSION_MISMATCH_CLOSE_CODE,
} from "../common/version_handshake.js";
import { decodeWire, WireCodec } from "./wire_codec.js";
import { liveWireCodec } from "./wire_schemas.js";
import {
    defaultWireSendPolicy, reportUncarriable, WireSendPolicy,
} from "./wire_send_policy.js";

/**
 * The close code and reason the client answers a TEXT frame with. The
 * wire is binary (Avro, protocol 7); a text frame means the server
 * speaks an older build's JSON wire, which the build handshake should
 * have refused. No fallback: see socket_channel_server.ts.
 */
export const TEXT_FRAME_CLOSE_CODE = 1003;
export const TEXT_FRAME_CLOSE_REASON =
    'text frames are not accepted: this client speaks the binary (Avro) wire';

export class SocketChannelClient implements ChannelClient {
    readonly message = new Subject<unknown>();
    readonly connected = new BehaviorSubject(false);

    webSocket: WebSocket;
    private webSocketFactory: () => WebSocket;
    warn: (m: string) => void;
    readonly timeout: number;
    private keepaliveTimeout?: NodeJS.Timeout;
    private pingsSentSinceMessage = 0;
    private messageListener: (m: MessageEvent) => void;
    private closeListener?: (e: CloseEvent) => void;
    /**
     * Messages waiting for the socket to open, in order. What may wait
     * here (#366):
     *  - a ping or pong never does: each probes the socket it is written
     *    to, so one that cannot be written now is stale by the time a
     *    socket can take it — replaying them was a burst of pings ahead of
     *    everything else on a just-recovered link;
     *  - before the FIRST connection, everything else does, as it always
     *    has (there is no earlier connection it could belong to);
     *  - once a connection has been LOST, nothing sent for it survives:
     *    the queue is dropped when the socket is replaced, and sends are
     *    dropped until the replacement's first inbound frame (`replacing`).
     *    The server assigns a uuid per socket, so the new connection is a
     *    NEW peer, in no room until its `connected` edge re-joins them
     *    (multi_room_communicator.ts joinCurrentRooms). Room traffic from
     *    the gap could only be refused as a non-member's ("Dropping inputs
     *    from <peer>: not in this room", rollback_relay.ts) — or, had any
     *    of it landed after the re-join, be stamped with the new uuid and
     *    clamped to the relay's current tick: stale inputs applied out of
     *    time. Nothing in it is needed: the re-entry (#354,
     *    simulation_bridge_host.ts) resyncs and re-inserts the fleet under
     *    the new uuid once the new uuid frame arrives.
     * The one frame a replacement does carry from the old connection is
     * the reconnect preamble (the token), always at the head.
     */
    private messageQueue: SocketMessage[] = [];
    /** What a replacement connection opens with (setReconnectPreamble). */
    private reconnectPreamble?: () => unknown;
    /** Set by the first inbound frame: a connection has existed. */
    private hadConnection = false;
    /** Between replacing a lost connection's socket and the replacement's
     * first inbound frame: sends are dropped (see `messageQueue`). */
    private replacing = false;
    private maxPings: number
    /** How socket messages become frames; the live wire unless a test
     * supplies its own. */
    private readonly codec: WireCodec;
    /** What `sendFrame` does with a message the codec rejects. */
    private readonly sendPolicy: WireSendPolicy;

    /**
     * Set once the server has refused this client for a build mismatch.
     *
     * Latches the reconnect machinery OFF. Without it the keepalive would
     * treat the refusal as an ordinary dropped connection and reconnect
     * every timeout, hammering a server that will refuse it every time --
     * and the page is on its way to reloading anyway. Only a reload (a
     * fresh bundle, hence a fresh client) clears this.
     */
    private versionRefused = false;

    constructor({ webSocket, warn, timeout, webSocketFactory, maxPings,
        buildVersion, onVersionMismatch, codec, sendPolicy }: {
            webSocket?: WebSocket,
            warn?: ((m: string) => void),
            timeout?: number,
            webSocketFactory?: () => WebSocket,
            maxPings?: number,
            codec?: WireCodec,
            /**
             * What to do with a message the codec cannot encode
             * (wire_send_policy.ts). The browser passes the policy the
             * server announced in the page; a caller that passes nothing
             * gets this process's own (`NODE_ENV`): strict under the
             * spec runner.
             */
            sendPolicy?: WireSendPolicy,
            /**
             * This bundle's build stamp, announced on the connect URL so
             * the server can refuse a stale client before admitting it.
             * When omitted no stamp is sent, which a version-checking
             * server treats as a mismatch.
             */
            buildVersion?: string,
            /**
             * Called when the server closes the socket with the
             * version-mismatch code. Opt-in: the close listener is only
             * registered when this is supplied, so a plain client keeps
             * exactly the listeners it always had.
             */
            onVersionMismatch?: (reason: string) => void,
        }) {
        this.webSocketFactory = webSocketFactory ?? (() => {
            const protocol = location.protocol === "https:" ? "wss" : "ws";
            const origin = `${protocol}://${location.host}`;
            if (buildVersion === undefined) {
                return new WebSocket(origin);
            }
            return new WebSocket(connectUrlWithVersion(origin, buildVersion));
        });

        this.codec = codec ?? liveWireCodec();
        this.sendPolicy = sendPolicy ?? defaultWireSendPolicy();
        this.webSocket = this.adopt(webSocket ?? this.webSocketFactory());
        this.warn = warn ?? console.warn;
        this.timeout = timeout ?? 1200;
        this.maxPings = maxPings ?? 3;

        if (onVersionMismatch) {
            this.closeListener = (event: CloseEvent) => {
                if (event.code !== VERSION_MISMATCH_CLOSE_CODE) {
                    return;
                }
                this.versionRefused = true;
                if (this.keepaliveTimeout !== undefined) {
                    clearTimeout(this.keepaliveTimeout);
                    this.keepaliveTimeout = undefined;
                }
                onVersionMismatch(event.reason);
            };
        }

        this.messageListener = this.handleMessage.bind(this)
        this.webSocket.addEventListener("message", this.messageListener);
        this.addCloseListener();
        this.resetTimeout();
    }

    private addCloseListener() {
        if (this.closeListener) {
            this.webSocket.addEventListener("close", this.closeListener);
        }
    }

    /**
     * Binary frames arrive as ArrayBuffers (the browser default is a
     * Blob, which needs an async read and would reorder messages).
     */
    private adopt(webSocket: WebSocket): WebSocket {
        try {
            webSocket.binaryType = 'arraybuffer';
        } catch {
            // A test double without the property; frames still decode.
        }
        return webSocket;
    }

    reconnect() {
        // A build-mismatched client stays down; see `versionRefused`.
        if (this.versionRefused) {
            return;
        }
        this.webSocket.removeEventListener("message", this.messageListener);
        // NOTE: the close listener is deliberately NOT removed from the
        // outgoing socket. A browser sets readyState to CLOSING/CLOSED
        // synchronously when a close frame arrives but dispatches the
        // `close` event as a queued task, so a keepalive firing inside
        // that window sees a dead socket and reconnects while a version
        // refusal is still pending delivery. Detaching here would drop
        // that event on the floor, the latch would never engage, and the
        // client would reconnect-loop forever against a server that
        // refuses it every time -- silently, with no reload. Leaving it
        // attached costs nothing (the discarded socket is collected along
        // with its listener) and lets a late 4001 still latch.
        if (this.webSocket.readyState === this.webSocket.CONNECTING
            || this.webSocket.readyState === this.webSocket.OPEN) {
            this.disconnect();
        } else if (this.connected.value) {
            // The SERVER closed the socket (a restart, a dropped link the
            // browser noticed first) and this is the first send since:
            // still drop `connected` before the new socket's first frame
            // raises it again. That false -> true edge is what re-joins
            // the client's rooms (multi_room_communicator.ts
            // joinCurrentRooms); without it the new socket, under its new
            // uuid, was in no room at all and the relay dropped
            // everything it sent (#354, #339).
            this.connected.next(false);
        }
        if (this.hadConnection) {
            // Everything queued was for the connection that is gone.
            this.messageQueue.length = 0;
            this.replacing = true;
        }
        const webSocket = this.adopt(this.webSocketFactory());
        this.webSocket = webSocket;
        webSocket.addEventListener("message", this.messageListener);
        this.addCloseListener();
        const preamble = this.hadConnection
            ? this.reconnectPreamble?.() : undefined;
        if (preamble !== undefined) {
            // The new connection's FIRST frame, written the moment the
            // socket opens: the server honours a reconnect token in that
            // position only (communicator_server.ts), and it needs nothing
            // from the server first — the client already holds the token,
            // and the server sends its uuid frame on connect regardless.
            this.messageQueue.unshift({ message: preamble });
            webSocket.addEventListener("open", () => {
                if (webSocket === this.webSocket) {
                    this.flush();
                }
            }, { once: true });
        }
        this.resetTimeout();
        this.sendPing();
    }

    setReconnectPreamble(preamble: () => unknown) {
        this.reconnectPreamble = preamble;
    }

    reconnectIfClosed() {
        if (this.versionRefused) {
            return;
        }
        if (this.webSocket.readyState === this.webSocket.CLOSED
            || this.webSocket.readyState === this.webSocket.CLOSING) {
            this.reconnect();
        }
    }

    send(message: unknown): void {
        this.sendRaw({ message });
    }

    private sendPing() {
        this.sendRaw({ ping: true });
        this.pingsSentSinceMessage++;
    }

    private keepaliveTimeoutCallback = () => {
        // A refused client must not re-arm the keepalive: doing so would
        // ping and re-time-out forever behind the reload.
        if (this.versionRefused) {
            return;
        }
        if (this.webSocket.readyState === this.webSocket.CLOSED
            || this.webSocket.readyState === this.webSocket.CLOSING
            || this.pingsSentSinceMessage > this.maxPings) {
            this.disconnect();
            this.warn("Lost connection. Reconnecting...");
            this.reconnect();
        }

        this.sendPing();
        this.resetTimeout();
    }

    resetTimeout() {
        if (this.keepaliveTimeout !== undefined) {
            clearTimeout(this.keepaliveTimeout);
        }
        this.keepaliveTimeout = setTimeout(
            this.keepaliveTimeoutCallback, this.timeout);
    }

    private sendRaw(message: SocketMessage) {
        // A refused client has no socket to flush to and will never get
        // one, so queueing would grow without bound behind the reload (or
        // behind the persistent error, if the loop guard stopped us).
        // Drop instead: nothing this client sends can be delivered.
        if (this.versionRefused) {
            this.messageQueue.length = 0;
            return;
        }
        this.reconnectIfClosed();
        // What may wait for a socket, and why: see `messageQueue`.
        const probe = message.ping === true || message.pong === true;
        if (probe ? this.webSocket.readyState !== this.webSocket.OPEN
            : this.replacing) {
            return;
        }
        this.messageQueue.push(message);
        this.flush();
    }

    private flush() {
        if (this.webSocket.readyState !== this.webSocket.OPEN) {
            return;
        }
        // Each message leaves the queue BEFORE it goes out, so a strict
        // sendFrame throw (a message the wire cannot carry) discards
        // that message alone: the ones behind it stay queued, in order,
        // for the next send.
        while (this.messageQueue.length > 0) {
            this.sendFrame(this.messageQueue.shift()!);
        }
    }

    /**
     * One socket message as one BINARY frame. A message the wire schema
     * does not admit is a bug in the sender: never sent, and under the
     * strict policy thrown to the caller (wire_send_policy.ts).
     */
    private sendFrame(message: SocketMessage) {
        let frame: Uint8Array;
        try {
            frame = this.codec.encode(SocketMessage.encode(message));
        } catch (error) {
            reportUncarriable(this.sendPolicy, this.warn,
                `Not sending a message the ${this.codec.encoding} wire `
                + `cannot carry: ${String(error)}`);
            return;
        }
        this.webSocket.send(frame);
    }

    private async handleMessage(messageEvent: MessageEvent) {
        this.resetTimeout();
        this.pingsSentSinceMessage = 0;
        // The connection is up: what is sent from here on is for it.
        this.hadConnection = true;
        this.replacing = false;
        if (!this.connected.value) {
            this.warn("Connected");
            this.connected.next(true);
        }

        const data: unknown = messageEvent.data;
        let bytes: Uint8Array;
        if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        } else if (data instanceof Uint8Array) {
            bytes = data;
        } else {
            // A text frame (a string), or a Blob from a socket whose
            // binaryType was reset: neither is the binary wire.
            this.warn(`Closing the socket: the server sent a `
                + `${typeof data === 'string' ? 'text' : 'non-binary'} frame; `
                + TEXT_FRAME_CLOSE_REASON);
            this.webSocket.close(TEXT_FRAME_CLOSE_CODE, TEXT_FRAME_CLOSE_REASON);
            return;
        }
        let socketMessage: SocketMessage;
        const maybeSocketMessage = decodeWire(this.codec, SocketMessage, bytes);
        if (isRight(maybeSocketMessage)) {
            socketMessage = maybeSocketMessage.right;
        } else {
            this.warn(`Failed to deserialize message from server: `
                + (maybeSocketMessage.left[0]?.message ?? 'not a socket message'));
            return;
        }

        if (socketMessage.pong) {
            // We already reset the timeout above.
            // No need to do anything if it's a pong.
            return;
        }

        if (socketMessage.ping) {
            // Reply with pong
            this.sendRaw({ pong: true });
            return;
        }

        const message = socketMessage.message;
        if (message) {
            this.message.next(message);
            return;
        }

        this.warn('Message had no body and was not a ping.');
    }

    disconnect() {
        this.webSocket.removeEventListener(
            "message", this.messageListener);
        this.webSocket.close();
        this.connected.next(false);
    }
}
