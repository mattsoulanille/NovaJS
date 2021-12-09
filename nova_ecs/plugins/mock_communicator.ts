import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { Communicator, Message, Peers } from './multiplayer_plugin';



export class MockCommunicator implements Communicator {
    peers: Peers;
    messages = new Subject<{ message: unknown; source: string; }>();
    allMessages: unknown[] = [];
    servers = new BehaviorSubject(new Set(['server']));

    constructor(public uuid: string | undefined,
        public mockPeers: Map<string, MockCommunicator> = new Map()) {
        const peers = new BehaviorSubject(new Set<string>());
        this.peers = new Peers(peers);
        peers.next(new Set([...mockPeers.keys()]));
        this.messages.subscribe(message => this.allMessages.push(message));
    }

    sendMessage(message: Message, destination?: string | Set<string>) {
        if (!this.uuid) {
            throw new Error('Cannot send a message without a uuid');
        }
        const JSONified = JSON.parse(JSON.stringify(message)) as unknown;

        const messageWithSource = {
            source: this.uuid,
            message: JSONified,
        };
        if (destination) {
            if (typeof destination === 'string') {
                this.mockPeers.get(destination)?.messages.next(messageWithSource);
            } else {
                for (const peer of destination) {
                    this.mockPeers.get(peer)?.messages.next(messageWithSource);
                }
            }
        } else {
            for (const peer of this.mockPeers.values()) {
                if (peer.uuid !== this.uuid) {
                    peer.messages.next(messageWithSource);
                }
            }
        }
    }
}
