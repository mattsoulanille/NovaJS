import { isLeft } from "fp-ts/lib/Either";
import produce from "immer";
import { Communicator } from "nova_ecs/plugins/multiplayer_plugin";
import { BehaviorSubject, Subject } from "rxjs";
import { ChannelServer } from "./Channel";
import { CommunicatorMessage, MessageType } from "./CommunicatorMessage";


export class CommunicatorServer implements Communicator {
    readonly messages = new Subject<{ source: string, message: unknown }>();
    readonly peers: BehaviorSubject<Set<string>>;
    readonly servers: BehaviorSubject<Set<string>>;

    constructor(private channel: ChannelServer, public uuid = 'server') {
        this.peers = new BehaviorSubject(channel.clients);
        for (const peer of this.peers.value) {
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
            if (maybeMessage.right.type !== MessageType.message) {
                console.warn(`${source} tried to change server uuid`);
                return;
            }

            const message = maybeMessage.right.message;
            const destination = maybeMessage.right.destination;

            let destSet: Set<string>;
            if (destination instanceof Set) {
                destSet = destination;
            } else if (typeof destination === 'string') {
                destSet = new Set([destination]);
            } else {
                destSet = new Set([...this.peers.value]);
                destSet.delete(source);
                destSet.add(this.uuid);
            }

            this.sendMessageWithSource(message, source, destSet);
        });

        // Send new clients a uuid
        channel.clientConnect.subscribe((clientId) => {
            // Notify the peer of its uuid
            this.sendUuid(clientId);
            this.peers.next(produce(this.peers.value, draft => {
                draft.add(clientId);
            }));
        });
        channel.clientDisconnect.subscribe((clientId) => {
            this.peers.next(produce(this.peers.value, draft => {
                draft.delete(clientId);
            }));
        });
    }

    private send(message: CommunicatorMessage, destination: string) {
        this.channel.send(destination, CommunicatorMessage.encode(message));
    }

    private sendUuid(uuid: string) {
        this.send({
            type: MessageType.uuid,
            uuid
        }, uuid);
    }

    private sendMessageWithSource(message: unknown, source: string,
        destination: Iterable<string>) {
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
        this.sendMessageWithSource(message, this.uuid,
            destination ?? this.peers.value);
    }
}

