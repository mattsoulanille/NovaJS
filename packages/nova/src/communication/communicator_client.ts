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

    constructor(private channel: ChannelClient) {
        this.connected = channel.connected;
        channel.message.subscribe(this.onMessage.bind(this));
    }
    // Both ends hardcode 'server' (CommunicatorServer rejects any other
    // uuid). Tracker issue: have the server announce its uuid set.
    servers = new BehaviorSubject(new Set(['server']));

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
                case MessageType.uuid:
                    this.uuid = communicatorMessage.uuid;
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
