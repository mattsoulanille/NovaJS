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

export class CommunicatorServer implements Communicator {
    readonly messages = new Subject<{ source: string, message: unknown }>();
    readonly peers: Peers;
    readonly servers: BehaviorSubject<Set<string>>;
    readonly connected: BehaviorSubject<boolean>;

    constructor(private channel: ChannelServer, public uuid = 'server') {
        this.connected = channel.connected;
        const peerJoin = new Subject<string>();
        const peerLeave = new Subject<string>();
        this.peers = new Peers({
            join: peerJoin,
            leave: peerLeave,
            initial: channel.clients,
        });
        for (const peer of this.peers.current.value) {
            this.sendUuid(peer);
        }
        if (uuid !== 'server') {
            throw new Error('UUIDs other than \'server\' are not yet supported');
        }

        this.servers = new BehaviorSubject(new Set([uuid]));

        // Handle messages from the channel
        channel.message.subscribe(({ message: commMessage, source }) => {
            const maybeMessage = CommunicatorMessage.decode(commMessage);
            if (isLeft(maybeMessage)) {
                console.warn(`Failed to decode message from ${source}`);
                return;
            }
            switch (maybeMessage.right.type) {
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

        channel.clientDisconnect.subscribe(peerLeave)
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

    private sendUuid(uuid: string) {
        this.send({
            type: MessageType.uuid,
            uuid
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

