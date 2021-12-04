import { isRight } from "fp-ts/lib/Either";
import { Communicator } from "nova_ecs/plugins/multiplayer_plugin";
import { BehaviorSubject, Subject } from "rxjs";
import { ChannelClient } from "./Channel";
import { CommunicatorMessage, MessageType } from "./CommunicatorMessage";


export class CommunicatorClient implements Communicator {
    readonly messages = new Subject<{ source: string, message: unknown }>();
    readonly peers = new BehaviorSubject<Set<string>>(new Set());
    uuid: string | undefined = undefined;

    constructor(private channel: ChannelClient) {
        channel.message.subscribe(this.onMessage.bind(this));
    }

    private onMessage(message: unknown) {
        const maybeMessage = CommunicatorMessage.decode(message);
        if (isRight(maybeMessage)) {
            const communicatorMessage = maybeMessage.right;
            if (communicatorMessage.type === MessageType.message) {
                if (typeof communicatorMessage.source !== 'string') {
                    console.warn(`Message ${message} missing source`);
                    return;
                }
                this.messages.next({
                    message: communicatorMessage.message,
                    source: communicatorMessage.source,
                });
            } else {
                this.uuid = communicatorMessage.uuid;
            }
        } else {
            console.warn(`Unable to decode message ${message}`);
        }
    }

    sendMessage(message: unknown, destination?: string | Set<string>) {
        this.channel.send(CommunicatorMessage.encode({
            type: MessageType.message,
            message,
            destination,
        }))
    }
}
