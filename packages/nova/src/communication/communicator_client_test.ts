import 'jasmine';
import { BehaviorSubject, Subject } from 'rxjs';
import { resetWarnThrottle } from '../common/log_throttle.js';
import { ChannelClient, ChannelServer, MessageWithSourceType } from './channel.js';
import { CommunicatorClient } from './communicator_client.js';
import { CommunicatorMessage, MessageType } from './communicator_message.js';
import { CommunicatorServer } from './communicator_server.js';
import { MultiRoom, RoomMessage } from './multi_room_communicator.js';
import { RollbackMessageHandlers, subscribeRollbackMessages } from './rollback_messages.js';
import { wrapRollbackMessage } from './rollback_protocol.js';

/**
 * Both ends used to hardcode the server's peer id as 'server' (#199).
 * The server now announces its uuid set in the uuid frame that opens
 * every connection, and the client takes `servers` from there alone —
 * so every "only the server may send X" check (Trust model item 4,
 * rollback_protocol.ts) runs against the ANNOUNCED set, which is empty
 * (nobody is trusted) until the announcement arrives.
 */

/** A client socket the spec writes server frames into directly. */
class MockClientChannel implements ChannelClient {
    readonly message = new Subject<unknown>();
    readonly connected = new BehaviorSubject(true);
    readonly sent: unknown[] = [];
    send(message: unknown) {
        this.sent.push(message);
    }
    disconnect() {
        this.connected.next(false);
    }
    /** A frame from the socket's server end. */
    frame(message: CommunicatorMessage) {
        this.message.next(CommunicatorMessage.encode(message));
    }
}

function tickSyncFrom(source: string, tick: number): CommunicatorMessage {
    return {
        type: MessageType.message, source,
        message: wrapRollbackMessage({ kind: 'tickSync', tick }),
    };
}

function recordTickSyncs(communicator: CommunicatorClient): number[] {
    const ticks: number[] = [];
    const handlers: RollbackMessageHandlers = {
        inputs: () => undefined,
        tickSync: tick => ticks.push(tick),
        inputLog: () => undefined,
        desync: () => undefined,
        desyncDumpRequest: () => undefined,
    };
    subscribeRollbackMessages(communicator, handlers);
    return ticks;
}

describe('CommunicatorClient server announcement', () => {
    let warn: jasmine.Spy;

    beforeEach(() => {
        resetWarnThrottle();
        warn = spyOn(console, 'warn');
    });

    it('takes the server set from the uuid frame, not a constant', () => {
        const channel = new MockClientChannel();
        const client = new CommunicatorClient(channel);
        const ticks = recordTickSyncs(client);

        channel.frame({
            type: MessageType.uuid, uuid: 'me',
            servers: new Set(['relay-1', 'relay-2']),
        });

        expect(client.uuid).toBe('me');
        expect(client.servers.value).toEqual(new Set(['relay-1', 'relay-2']));
        channel.frame(tickSyncFrom('relay-2', 5));
        expect(ticks).toEqual([5]);
    });

    it('refuses a peer claiming the old constant server uuid', () => {
        const channel = new MockClientChannel();
        const client = new CommunicatorClient(channel);
        const ticks = recordTickSyncs(client);
        channel.frame({
            type: MessageType.uuid, uuid: 'me', servers: new Set(['relay-1']),
        });

        channel.frame(tickSyncFrom('server', 7));
        channel.frame(tickSyncFrom('mallory', 8));

        expect(ticks).toEqual([]);
        expect(warn).toHaveBeenCalledWith(
            jasmine.stringMatching(/non-server peer server/));
    });

    it('refuses server-only messages that arrive before the announcement', () => {
        const channel = new MockClientChannel();
        const client = new CommunicatorClient(channel);
        const ticks = recordTickSyncs(client);
        const room = new MultiRoom(client).join('nova:129');
        const roomPeers: Set<string>[] = [];
        room.peers.current.subscribe(peers => roomPeers.push(peers));

        expect(client.servers.value.size).toBe(0);
        channel.frame(tickSyncFrom('server', 1));
        channel.frame({
            type: MessageType.message, source: 'server',
            message: RoomMessage.encode({
                room: 'nova:129', peers: new Set(['server', 'forged']),
            }),
        });
        expect(ticks).toEqual([]);
        expect(roomPeers).toEqual([new Set()]);

        // The same traffic after the announcement is accepted.
        channel.frame({
            type: MessageType.uuid, uuid: 'me', servers: new Set(['server']),
        });
        channel.frame(tickSyncFrom('server', 2));
        expect(ticks).toEqual([2]);
    });
});

/**
 * One CommunicatorServer and its clients over an in-memory socket
 * layer, so the announcement and its provenance are the real server's.
 */
class LinkedChannels implements ChannelServer {
    readonly message = new Subject<MessageWithSourceType<unknown>>();
    readonly clientConnect = new Subject<string>();
    readonly clientDisconnect = new Subject<string>();
    readonly connected = new BehaviorSubject(true);
    readonly clients = new Set<string>();
    private sockets = new Map<string, Subject<unknown>>();

    send(destination: string, message: unknown) {
        this.sockets.get(destination)?.next(message);
    }

    /** Opens `uuid`'s socket; `frames` records what reaches it. */
    connect(uuid: string) {
        const inbound = new Subject<unknown>();
        const frames: unknown[] = [];
        inbound.subscribe(frame => frames.push(frame));
        this.sockets.set(uuid, inbound);
        const socket: ChannelClient = {
            message: inbound,
            connected: new BehaviorSubject(true),
            send: message => this.message.next({ source: uuid, message }),
            disconnect: () => undefined,
        };
        const client = new CommunicatorClient(socket);
        this.clients.add(uuid);
        this.clientConnect.next(uuid);
        return { socket, client, frames };
    }
}

describe('CommunicatorServer announcement', () => {
    beforeEach(() => {
        resetWarnThrottle();
        spyOn(console, 'warn');
    });

    it('announces its uuid set in the first frame a client receives', () => {
        const channels = new LinkedChannels();
        new CommunicatorServer(channels);
        const { client, frames } = channels.connect('a');

        expect(CommunicatorMessage.decode(frames[0])).toEqual(
            jasmine.objectContaining({
                right: {
                    type: MessageType.uuid, uuid: 'a',
                    servers: new Set(['server']),
                },
            }));
        expect(client.servers.value).toEqual(new Set(['server']));
    });

    it('a peer cannot announce a server set to another peer', () => {
        const channels = new LinkedChannels();
        new CommunicatorServer(channels);
        const { client: victim } = channels.connect('victim');
        const ticks = recordTickSyncs(victim);
        const { socket: mallory } = channels.connect('mallory');

        const announce: CommunicatorMessage = {
            type: MessageType.uuid, uuid: 'victim',
            servers: new Set(['mallory']),
        };
        // As a raw uuid frame (the server drops it), and smuggled as a
        // routed message's payload (the victim decodes only the outer
        // envelope, a sourced `message`).
        mallory.send(CommunicatorMessage.encode(announce));
        mallory.send(CommunicatorMessage.encode({
            type: MessageType.message, destination: 'victim',
            message: CommunicatorMessage.encode(announce),
        }));
        mallory.send(CommunicatorMessage.encode({
            type: MessageType.message, destination: 'victim',
            message: wrapRollbackMessage({ kind: 'tickSync', tick: 9 }),
        }));

        expect(victim.servers.value).toEqual(new Set(['server']));
        expect(victim.uuid).toBe('victim');
        expect(ticks).toEqual([]);
    });
});
