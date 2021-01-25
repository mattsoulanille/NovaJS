import { isRight } from "fp-ts/lib/Either";
import { Communicator, Message } from "nova_ecs/plugins/multiplayer_plugin";
import { ChannelClient } from "./Channel";
import { CommunicatorMessage, MessageType } from "./CommunicatorMessage";


export class CommunicatorClient implements Communicator {
    private messages: Message[] = [];
    uuid: string | undefined = undefined;

    constructor(private channel: ChannelClient) {
        channel.message.subscribe(this.onMessage.bind(this));
    }

    private onMessage(message: unknown) {
        const maybeMessage = CommunicatorMessage.decode(message);
        if (isRight(maybeMessage)) {
            const communicatorMessage = maybeMessage.right;
            if (communicatorMessage.type === MessageType.message) {
                this.messages.push(communicatorMessage.message);
            } else {
                this.uuid = communicatorMessage.uuid;
            }
        } else {
            console.warn(`Unable to decode message ${message}`);
        }
    }

    sendMessage(message: Message) {
        this.channel.send(CommunicatorMessage.encode({
            type: MessageType.message,
            message
        }))
    }

    getMessages() {
        const messages = this.messages;
        this.messages = [];
        return messages;
    }
}
