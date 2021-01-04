import { isLeft } from "fp-ts/lib/Either";
import { Message } from "../ecs/plugins/multiplayer_plugin";
import { ChannelServer } from "./Channel";
import { Communicator } from "./Communicator";


export class CommunicatorServer implements Communicator {
    peers = new Set<string>();
    private messages: Message[] = [];

    constructor(private channel: ChannelServer) {
        channel.clientConnect.subscribe((clientId) => {
            this.peers.add(clientId);
            this.messages.push({
                source: 'server',
                peers: new Set([...this.peers])
            });
        });

        channel.clientDisconnect.subscribe((clientId) => {
            this.peers.delete(clientId);
            this.messages.push({
                source: 'server',
                peers: new Set([...this.peers])
            });
        });

        channel.message.subscribe(({ message, source }) => {
            const maybeMessage = Message.decode(message);
            if (isLeft(maybeMessage)) {
                console.warn(`Failed to decode message ${maybeMessage} from ${source}`);
                return;
            }

            maybeMessage.right.source = source;
            this.messages.push(maybeMessage.right);

            // Rebroadcast messages
            for (const otherId of this.channel.clients) {
                if (otherId !== source) {
                    this.send(maybeMessage.right, otherId);
                }
            }
        });
    }
    private send(message: Message, destination: string) {
        this.channel.send(destination, Message.encode(message));
    }

    sendMessage(message: Message, destination?: string) {
        message.source = 'server';
        if (destination) {
            this.send(message, destination);
        } else {
            for (const clientId of this.channel.clients) {
                this.send(message, clientId);
            }
        }
    }

    getMessages() {
        const messages = this.messages;
        this.messages = [];
        return messages;
    }
}

