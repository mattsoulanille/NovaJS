import { isRight } from "fp-ts/lib/Either";
import { Message } from "../ecs/plugins/multiplayer_plugin";
import { ChannelClient } from "./Channel";
import { Communicator } from "./Communicator";

export class CommunicatorClient implements Communicator {
    private messages: Message[] = [];
    constructor(private channel: ChannelClient) {
        channel.message.subscribe(this.onMessage.bind(this));
    }

    private onMessage(message: unknown) {
        const maybeMessage = Message.decode(message);
        if (isRight(maybeMessage)) {
            this.messages.push(maybeMessage.right);
        } else {
            console.warn(`Unable to decode message ${message}`);
        }
    }

    sendMessage(message: Message) {
        this.channel.send(Message.encode(message));
    }

    getMessages() {
        const messages = this.messages;
        this.messages = [];
        return messages;
    }
}
