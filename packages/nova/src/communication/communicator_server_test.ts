import 'jasmine';
import { BehaviorSubject, Subject } from 'rxjs';
import { ChannelServer, MessageWithSourceType } from './channel.js';
import { CommunicatorMessage, MessageType } from './communicator_message.js';
import { CommunicatorServer } from './communicator_server.js';

/**
 * The server honoured whatever `destination` a client put in its
 * envelope, forwarding to any other client by uuid (peer uuids are
 * public: the server broadcasts the room list). That was the delivery
 * path for every forged protocol message (a tickSync, a desync naming
 * the victim, an inputLog steering it) and for the legacy delta-sync
 * plugin's `remove: ['singleton']`, which froze every receiving client.
 * A client now speaks to the server only.
 */
class MockChannel implements ChannelServer {
    readonly message = new Subject<MessageWithSourceType<unknown>>();
    readonly clientConnect = new Subject<string>();
    readonly clientDisconnect = new Subject<string>();
    readonly connected = new BehaviorSubject(true);
    readonly clients = new Set<string>(['a', 'b']);
    readonly sent: [string, CommunicatorMessage][] = [];
    send(destination: string, message: unknown) {
        this.sent.push([destination, message as CommunicatorMessage]);
    }
}

describe('CommunicatorServer', () => {
    let channel: MockChannel;
    let server: CommunicatorServer;
    let received: { source: string, message: unknown }[];

    beforeEach(() => {
        channel = new MockChannel();
        server = new CommunicatorServer(channel);
        received = [];
        server.messages.subscribe(m => received.push(m));
        channel.sent.length = 0;
    });

    function fromClient(source: string, message: unknown,
        destination?: string | Set<string>) {
        channel.message.next({
            source,
            message: CommunicatorMessage.encode({
                type: MessageType.message, message,
                ...(destination !== undefined ? { destination } : {}),
            }),
        });
    }

    function relayedTo(uuid: string) {
        return channel.sent
            .filter(([dest, m]) => dest === uuid && m.type === MessageType.message)
            .map(([, m]) => m.type === MessageType.message ? m.message : undefined);
    }

    it('delivers a client message addressed to another client to the server only',
        () => {
            fromClient('a', { remove: ['singleton'] }, 'b');
            expect(relayedTo('b')).toEqual([]);
            expect(received).toEqual([
                { source: 'a', message: { remove: ['singleton'] } },
            ]);
        });

    it('delivers a client broadcast (no destination) to the server only', () => {
        fromClient('a', { state: [] });
        expect(relayedTo('b')).toEqual([]);
        expect(received.length).toBe(1);
    });

    it('delivers a client message addressed to the server, as before', () => {
        fromClient('a', { rollback: { kind: 'joinRequest' } }, 'server');
        expect(received).toEqual([
            { source: 'a', message: { rollback: { kind: 'joinRequest' } } },
        ]);
    });

    it('the server itself still fans out to clients', () => {
        server.sendMessage({ rollback: { kind: 'tickSync', tick: 1 } },
            new Set(['a', 'b']));
        expect(relayedTo('a').length).toBe(1);
        expect(relayedTo('b').length).toBe(1);
    });
});
