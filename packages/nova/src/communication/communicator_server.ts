import { randomBytes } from "crypto";
import { isLeft } from "fp-ts/lib/Either.js";
import { Communicator, Peers } from "nova_ecs/plugins/multiplayer_plugin";
import { BehaviorSubject, Subject } from "rxjs";
import { warnThrottled } from "../common/log_throttle.js";
import { ChannelServer } from "./channel.js";
import { CommunicatorMessage, MessageType } from "./communicator_message.js";

/** Whether a client-chosen destination names anyone but the server
 * (undefined means "the room", which also includes other clients). */
function namesOthers(destination: string | Set<string> | undefined,
    server: string): boolean {
    if (destination === undefined) {
        return true;
    }
    if (typeof destination === 'string') {
        return destination !== server;
    }
    return [...destination].some(dest => dest !== server);
}

/** CSPRNG bytes in a reconnect token: 256 bits, so guessing one is not
 * a strategy. */
const RECONNECT_TOKEN_BYTES = 32;

/**
 * A fresh reconnect token (#354): node's CSPRNG, never Math.random, and
 * never anything the simulation can see — tokens live in this class and
 * in the one client's memory, nowhere else.
 */
function generateReconnectToken(): string {
    return randomBytes(RECONNECT_TOKEN_BYTES).toString('base64url');
}

export class CommunicatorServer implements Communicator {
    readonly messages = new Subject<{ source: string, message: unknown }>();
    readonly peers: Peers;
    readonly servers: BehaviorSubject<Set<string>>;
    readonly connected: BehaviorSubject<boolean>;
    /**
     * ============================================================
     * Reconnect tokens (#354; Trust model item 6, rollback_protocol.ts)
     * ============================================================
     * Every connection is issued a token in its uuid frame (sendUuid):
     * a bearer secret only that client and this server know. A client
     * whose socket died presents its PREVIOUS connection's token as the
     * first communicator frame of its next connection; the server then
     * retires that previous connection at once — closes it and emits its
     * departure through the normal path, so every room sees the old peer
     * leave (the relay's removePeer) before the new connection's own
     * traffic is handled — instead of waiting up to a minute for the
     * keepalive to notice a half-open socket.
     *
     * The rules, each of which the presentation path below enforces:
     *  - one token per connection, issued fresh on every connection and
     *    forgotten when that connection goes, so a token outlives its
     *    connection by nothing and is never reissued;
     *  - single use: redeeming it forgets it;
     *  - bound to the connection it was issued to: it retires THAT
     *    connection and nothing else, and only from a different one;
     *  - honoured only as a connection's FIRST communicator frame: a peer
     *    already speaking cannot retire anybody with one;
     *  - never answered: a wrong, spent or misplaced token is ignored,
     *    and the presenter proceeds as the brand-new connection it is,
     *    learning nothing about whether the token ever existed;
     *  - never logged, never relayed, never handed to the simulation;
     *  - grants no identity: the presenter keeps its own new uuid, and
     *    nothing the retired connection owned is transferred (its fleet
     *    leaves with it; the client re-inserts it under the new uuid).
     */
    /** Token -> the connection it was issued to. */
    private readonly tokens = new Map<string, string>();
    /** Connection -> its token. */
    private readonly tokenOf = new Map<string, string>();
    /** Connections that have sent a communicator frame: a token is
     * honoured only as a connection's first. */
    private readonly spoken = new Set<string>();

    constructor(private channel: ChannelServer, public uuid = 'server') {
        this.connected = channel.connected;
        const peerJoin = new Subject<string>();
        const peerLeave = new Subject<string>();
        this.peers = new Peers({
            join: peerJoin,
            leave: peerLeave,
            initial: channel.clients,
        });
        // Clients learn this set from the uuid frame (sendUuid), but a
        // world with no communicator — the server's archive sim, offline
        // log replay — still falls back to simulation_input.ts's
        // DEFAULT_SERVER_PEERS, so the server's own uuid stays fixed.
        if (uuid !== 'server') {
            throw new Error('UUIDs other than \'server\' are not yet supported');
        }

        this.servers = new BehaviorSubject(new Set([uuid]));
        // After `servers` exists: the uuid frame announces it.
        for (const peer of this.peers.current.value) {
            this.sendUuid(peer);
        }

        // Handle messages from the channel
        channel.message.subscribe(({ message: commMessage, source }) => {
            const firstFrame = !this.spoken.has(source);
            this.spoken.add(source);
            const maybeMessage = CommunicatorMessage.decode(commMessage);
            if (isLeft(maybeMessage)) {
                console.warn(`Failed to decode message from ${source}`);
                return;
            }
            switch (maybeMessage.right.type) {
                case MessageType.reconnect:
                    if (firstFrame) {
                        this.redeemToken(source, maybeMessage.right.token);
                    } else {
                        // (The token itself is never logged.)
                        warnThrottled(`server-late-token:${source}`, () =>
                            `${source} presented a reconnect token after its `
                            + 'first frame; ignoring it');
                    }
                    return;
                case MessageType.uuid:
                    console.warn(`${source} tried to change server uuid`);
                    return;
                case MessageType.peers:
                    console.warn(`${source} tried to change server peers`);
                    return;
                case MessageType.message: {
                    // Trust model item 3 (rollback_protocol.ts): a
                    // client's message is delivered to the SERVER only,
                    // whatever destination it named. Nothing in the
                    // input-record design needs
                    // client->client delivery — the rollback relay is
                    // the single fan-out, and every client accepts
                    // rollback traffic from the server alone (see
                    // simulation_bridge.ts). Honouring the client's
                    // destination let any peer push forged protocol
                    // control messages (and the legacy delta-sync
                    // plugin's remove/state) straight to a chosen
                    // victim, with the server's own stamp of the
                    // sender as the only provenance.
                    const message = maybeMessage.right.message;
                    const destination = maybeMessage.right.destination;
                    if (namesOthers(destination, this.uuid)) {
                        warnThrottled(`server-dest:${source}`, () =>
                            `${source} addressed peers directly; `
                            + 'delivering to the server only');
                    }
                    this.sendMessageWithSource(message, source,
                        new Set([this.uuid]));
                    return;
                }
            }
        });

        // Send new clients a uuid
        channel.clientConnect.subscribe((clientId) => {
            // Notify the peer of its uuid
            this.sendUuid(clientId);
            peerJoin.next(clientId);
        });
        this.peers.current.subscribe(() => {
            this.sendPeers();
        });

        channel.clientDisconnect.subscribe(clientId => {
            // A token outlives its connection by nothing.
            this.forgetToken(clientId);
            this.spoken.delete(clientId);
        });
        channel.clientDisconnect.subscribe(peerLeave)
    }

    /** Issues `clientId` a fresh token, replacing any it held. */
    private issueToken(clientId: string): string {
        this.forgetToken(clientId);
        const token = generateReconnectToken();
        this.tokens.set(token, clientId);
        this.tokenOf.set(clientId, token);
        return token;
    }

    private forgetToken(clientId: string) {
        const token = this.tokenOf.get(clientId);
        if (token !== undefined) {
            this.tokens.delete(token);
            this.tokenOf.delete(clientId);
        }
    }

    /**
     * `presenter`'s first frame was a reconnect token: retire the
     * connection it was issued to, if it names a live one other than the
     * presenter's own. Silent either way (see the token rules above) —
     * the retirement's only visible effect is the old peer leaving, the
     * same thing its own close would have caused.
     */
    private redeemToken(presenter: string, token: string) {
        const previous = this.tokens.get(token);
        if (previous === undefined || previous === presenter) {
            return;
        }
        this.forgetToken(previous);
        console.log(`Retiring connection ${previous}: superseded by `
            + `${presenter}'s reconnect`);
        // Synchronous: the old peer's departure (every room's peer set,
        // the relay's removePeer record) completes before the presenter's
        // next frame — its room joins, its catch-up request — is handled.
        this.channel.disconnect(previous);
    }

    private getDestSet(source: string, destination?: string | Set<string>) {
        let destSet: Set<string>;
        if (destination instanceof Set) {
            destSet = destination;
        } else if (typeof destination === 'string') {
            destSet = new Set([destination]);
        } else {
            destSet = new Set([...this.peers.current.value]);
            destSet.delete(source);
            destSet.add(this.uuid);
        }
        return destSet;
    }

    private send(message: CommunicatorMessage, destination: string) {
        this.channel.send(destination, CommunicatorMessage.encode(message));
    }

    private sendPeers() {
        const message: CommunicatorMessage = {
            type: MessageType.peers,
            peers: this.peers.current.value,
        }
        for (const peer of this.peers.current.value) {
            this.send(message, peer);
        }
    }

    /** The client's first frame: its uuid, the server uuid set it
     * accepts server-only traffic from (Trust model item 4), and its
     * connection's reconnect token (item 6). */
    private sendUuid(uuid: string) {
        this.send({
            type: MessageType.uuid,
            uuid,
            servers: new Set(this.servers.value),
            // To this connection's own socket only.
            token: this.issueToken(uuid),
        }, uuid);
    }

    private sendMessageWithSource(message: unknown, source: string,
        destination: Set<string>) {
        const communicatorMessage: CommunicatorMessage = {
            type: MessageType.message,
            message, source
        };

        for (const dest of destination) {
            if (dest === this.uuid) {
                this.messages.next({ message, source });
            } else if (this.channel.clients.has(dest)) {
                this.send(communicatorMessage, dest);
            }
        }

    }

    sendMessage(message: unknown, destination?: string | Set<string>) {
        const dest = this.getDestSet(this.uuid, destination);
        this.sendMessageWithSource(message, this.uuid, dest);
    }
}

