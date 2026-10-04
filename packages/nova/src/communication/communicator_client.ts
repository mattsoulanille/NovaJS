import { isRight } from "fp-ts/lib/Either.js";
import { Communicator, Peers } from "nova_ecs/plugins/multiplayer_plugin";
import { BehaviorSubject, Subject } from "rxjs";
import { ChannelClient } from "./channel.js";
import { CommunicatorMessage, MessageType } from "./communicator_message.js";


export class CommunicatorClient implements Communicator {
    readonly messages = new Subject<{ source: string, message: unknown }>();
    readonly peers = new Peers(new BehaviorSubject(new Set()));
    readonly connected: BehaviorSubject<boolean>;
    uuid: string | undefined = undefined;
    /**
     * `uuid`, as a stream: the server assigns a peer uuid per SOCKET, so
     * every reconnect (a network drop, a server restart) announces a NEW
     * one in its uuid frame (#354). Whatever stamped or forwarded the old
     * id — the simulation worker's copy of it (client/system_entry.ts),
     * the ownership of the fleet the client holds (client/identity.ts) —
     * follows the current value from here. Emits on every uuid frame,
     * after `uuid` and `servers` are updated.
     */
    readonly identity = new BehaviorSubject<string | undefined>(undefined);
    /**
     * The reconnect token the server issued THIS connection in its uuid
     * frame (#354; communicator_server.ts, Trust model item 6). A bearer
     * secret: held here, in memory, and nowhere else — never forwarded to
     * the simulation worker, never sent to anyone but the server, never
     * logged. Presented as the first frame of the NEXT connection, so the
     * server retires this one at once instead of waiting for its
     * keepalive to notice a half-open socket; replaced by the fresh token
     * that connection's uuid frame brings. Until then every replacement
     * socket the channel tries opens with it (a handshake that never
     * completed carried nothing); the server spends it on first use, so a
     * later presentation of it is simply ignored there.
     *
     * Memory only, deliberately not localStorage: a page reload is a new
     * session that re-enters from the pilot save, and its old socket was
     * closed by the browser on unload (a close the server sees at once),
     * so there is nothing for a stored token to retire — while a stored
     * bearer secret would outlive the tab, be readable by any script on
     * the origin, and be shared by every tab of it.
     */
    private reconnectToken: string | undefined = undefined;

    constructor(private channel: ChannelClient) {
        this.connected = channel.connected;
        channel.setReconnectPreamble(() => this.reconnectFrame());
        channel.message.subscribe(this.onMessage.bind(this));
    }

    /**
     * What a replacement connection opens with: the token of the
     * connection this client held, if it held one, so the server retires
     * it. The server honours a token only as a connection's FIRST frame,
     * so it cannot wait for the new connection's `connected` edge: by
     * then a browser socket has queued pings and room traffic ahead of
     * anything sent (#366). The channel writes it before everything else,
     * the moment the socket opens (socket_channel_client.ts). Unanswered
     * by design: the client cannot tell whether it retired anything, and
     * does not need to — the old peer's removePeer, when there is one,
     * reaches it through the room like any other.
     */
    private reconnectFrame(): unknown {
        const token = this.reconnectToken;
        if (token === undefined) {
            return undefined;
        }
        return CommunicatorMessage.encode({
            type: MessageType.reconnect,
            token,
        });
    }
    /**
     * The server's uuid set, as the server ANNOUNCED it in the uuid
     * frame that opens every connection (communicator_message.ts).
     * Empty until then, so every "only from a server" check (Trust
     * model item 4, rollback_protocol.ts) refuses everything that
     * arrives before the announcement. Only a uuid frame sets it, and
     * only the socket's server end can send one: whatever another peer
     * says reaches this client inside a relayed `message`, which never
     * touches this set.
     *
     * Deliberately NOT cleared on disconnect: records already applied
     * with a server's peerId (removePeer) are re-applied by rollbacks
     * while the socket is down, and their authorisation
     * (simulation_input.ts isServerPeer) must not change under them.
     * Each reconnect's uuid frame re-announces the set.
     */
    readonly servers = new BehaviorSubject(new Set<string>());

    private onMessage(message: unknown) {
        const maybeMessage = CommunicatorMessage.decode(message);
        if (isRight(maybeMessage)) {
            const communicatorMessage = maybeMessage.right;
            switch (communicatorMessage.type) {
                case MessageType.message:
                    if (typeof communicatorMessage.source !== 'string') {
                        console.warn(`Message ${message} missing source`);
                        return;
                    }
                    this.messages.next({
                        message: communicatorMessage.message,
                        source: communicatorMessage.source,
                    });
                    break;
                case MessageType.peers:
                    this.peers.current.next(communicatorMessage.peers);
                    break;
                case MessageType.reconnect:
                    // Client -> server only; nothing a server sends.
                    console.warn('Ignoring a reconnect frame from the server');
                    break;
                case MessageType.uuid:
                    this.reconnectToken = communicatorMessage.token;
                    this.uuid = communicatorMessage.uuid;
                    this.servers.next(new Set(communicatorMessage.servers));
                    this.identity.next(communicatorMessage.uuid);
                    break;
            }
        } else {
            console.warn(`Unable to decode message ${message}`);
        }
    }

    sendMessage(message: unknown, destination?: string | Set<string>) {
        if (this.uuid) {
            if (destination === this.uuid) {
                this.messages.next({ source: this.uuid, message });
                return;
            }
            if (destination instanceof Set) {
                if (destination.has(this.uuid)) {
                    this.messages.next({ source: this.uuid, message });
                    destination = new Set([...destination]);
                    destination.delete(this.uuid);
                }
                if (destination.size === 0) {
                    return;
                }
            }
        }

        this.channel.send(CommunicatorMessage.encode({
            type: MessageType.message,
            message,
            destination,
        }))
    }
}
