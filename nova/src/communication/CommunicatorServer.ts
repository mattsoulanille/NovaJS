import { isLeft } from "fp-ts/lib/Either";
import produce from "immer";
import { Communicator } from "nova_ecs/plugins/multiplayer_plugin";
import { BehaviorSubject, Subject } from "rxjs";
import { ChannelServer } from "./Channel";
import { CommunicatorMessage, MessageType } from "./CommunicatorMessage";


export class CommunicatorServer implements Communicator {
    readonly messages = new Subject<unknown>();
    readonly peers = new BehaviorSubject(new Set<string>());

    constructor(private channel: ChannelServer, public uuid = 'server') {
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

            // TODO: Fix this
            (message as { source: string }).source = source;

            const destination = maybeMessage.right.destination;
            if (destination) {
                if (destination === this.uuid) {
                    this.messages.next(message);
                } else {
                    if (this.channel.clients.has(destination)) {
                        this.sendMessage(message, destination);
                    }
                }
            } else {
                // Rebroadcast messages
                for (const otherId of this.channel.clients) {
                    if (otherId !== source) {
                        this.sendMessage(message, otherId);
                    }
                }
                // And receive the message ourselves.
                this.messages.next(message);
            }
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

    sendMessage(message: unknown, destination?: string) {
        const communicatorMessage: CommunicatorMessage = {
            type: MessageType.message,
            message
        }

        if (destination) {
            this.send(communicatorMessage, destination);
        } else {
            for (const clientId of this.channel.clients) {
                this.send(communicatorMessage, clientId);
            }
        }
    }
}

