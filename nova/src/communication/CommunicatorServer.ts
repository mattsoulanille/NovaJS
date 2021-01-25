import { isLeft } from "fp-ts/lib/Either";
import { Communicator, Message } from "nova_ecs/plugins/multiplayer_plugin";
import { ChannelServer } from "./Channel";
import { CommunicatorMessage, MessageType } from "./CommunicatorMessage";


export class CommunicatorServer implements Communicator {
    peers = new Set<string>();
    private messages: Message[] = [];

    constructor(private channel: ChannelServer, public uuid = 'server') {
        channel.clientConnect.subscribe((clientId) => {
            this.peers.add(clientId);
            // Notify the peer of its uuid
            this.sendUuid(clientId);
            // Notify the server of the new peer
            this.messages.push({
                source: uuid,
                peers: new Set([...this.peers])
            });
        });

        channel.clientDisconnect.subscribe((clientId) => {
            this.peers.delete(clientId);
            this.messages.push({
                source: uuid,
                peers: new Set([...this.peers])
            });
        });

        channel.message.subscribe(({ message, source }) => {
            const maybeMessage = CommunicatorMessage.decode(message);
            if (isLeft(maybeMessage)) {
                console.warn(`Failed to decode message from ${source}`);
                return;
            }
            if (maybeMessage.right.type !== MessageType.message) {
                console.warn(`${source} tried to change server uuid`);
                return;
            }

            const messageFromClient = maybeMessage.right.message;
            messageFromClient.source = source;
            this.messages.push(messageFromClient);

            // Rebroadcast messages
            for (const otherId of this.channel.clients) {
                if (otherId !== source) {
                    this.sendMessage(messageFromClient, otherId);
                }
            }
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

    sendMessage(message: Message, destination?: string) {
        message.source = this.uuid;

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

    getMessages() {
        const messages = this.messages;
        this.messages = [];
        return messages;
    }
}

