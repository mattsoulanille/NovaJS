import { isLeft } from "fp-ts/lib/Either";
import { Communicator, Peers } from "nova_ecs/plugins/multiplayer_plugin";
import { BehaviorSubject, Subject } from "rxjs";
import { ChannelServer } from "./Channel";
import { CommunicatorMessage, MessageType } from "./CommunicatorMessage";


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
                case MessageType.message:
                    const message = maybeMessage.right.message;
                    const destination = maybeMessage.right.destination;
                    this.sendMessageWithSource(message, source, this.getDestSet(source, destination));
                    return;
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

