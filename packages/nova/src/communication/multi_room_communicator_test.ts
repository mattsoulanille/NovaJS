import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { MultiRoom } from './multi_room_communicator.js';


describe('MultiRoomCommunicator', () => {
    let c1: MockCommunicator;
    let c2: MockCommunicator;
    let serverCommunicator: MockCommunicator;
    let r1: MultiRoom;
    let r2: MultiRoom;
    let server: MultiRoom;
    let mockPeers: Map<string, MockCommunicator>;

    beforeEach(() => {
        c1 = new MockCommunicator('c1');
        c2 = new MockCommunicator('c2');
        serverCommunicator = new MockCommunicator('server');

        mockPeers = new Map([
            [c1.uuid as string, c1],
            [c2.uuid as string, c2],
            [serverCommunicator.uuid as string, serverCommunicator],
        ]);

        c1.mockPeers = mockPeers;
        c2.mockPeers = mockPeers;
        serverCommunicator.mockPeers = mockPeers;

        const peers = new Set([...mockPeers.keys()]);
        c1.peers.current.next(peers);
        c2.peers.current.next(peers);
        serverCommunicator.peers.current.next(peers);

        r1 = new MultiRoom(c1);
        r2 = new MultiRoom(c2);
        server = new MultiRoom(serverCommunicator);
    });

    it('server can join a room', () => {
        const serverRoom1 = server.join('room1');
        expect(serverRoom1.peers.current.value)
            .toEqual(new Set([serverCommunicator.uuid]));
    });

    it('peers can join a room', () => {
        const r1Room1 = r1.join('room1');
        const r2Room1 = r2.join('room1');

        const r2Room2 = r2.join('room2');
        const serverRoom2 = server.join('room2');

        expect(r1Room1.peers.current.value)
            .toEqual(new Set([c1.uuid, c2.uuid]));
        expect(r2Room1.peers.current.value)
            .toEqual(new Set([c1.uuid, c2.uuid]));

        expect(r2Room2.peers.current.value)
            .toEqual(new Set([c2.uuid, serverCommunicator.uuid]));
        expect(serverRoom2.peers.current.value)
            .toEqual(new Set([c2.uuid, serverCommunicator.uuid]));
    });

    it('a peer can leave a room after joining', () => {
        const r1Room1 = r1.join('room1');
        r2.join('room1');

        expect(r1Room1.peers.current.value)
            .toEqual(new Set([c1.uuid, c2.uuid]));

        r2.leave('room1');

        expect(r1Room1.peers.current.value)
            .toEqual(new Set([c1.uuid]));
    });

    it('messages sent in one room appear only in that room', () => {
        const r1Room1 = r1.join('room1');
        const r2Room1 = r2.join('room1');
        const r2Room2 = r2.join('room2');

        const r1Messages: { message: unknown, source: string }[] = [];
        r2Room1.messages.subscribe(m => r1Messages.push(m));

        const r2Messages: { message: unknown, source: string }[] = [];
        r2Room2.messages.subscribe(m => r2Messages.push(m));

        const testMessage = 'test message';
        r1Room1.sendMessage(testMessage);
        expect(r1Messages).toEqual([{ message: testMessage, source: c1.uuid! }]);
        expect(r2Messages).toEqual([]);
    });

    it('removes peer from room when the underlying communicator loses a peer', () => {
        const serverRoom1 = server.join('room1');
        const r1Room1 = r1.join('room1');
        r2.join('room1');

        mockPeers.delete(c2.uuid!);
        const newPeers = new Set([c1.uuid, serverCommunicator.uuid]);
        serverCommunicator.peers.current.next(new Set([c1.uuid!, serverCommunicator.uuid!]));
        c1.peers.current.next(new Set([c1.uuid!, serverCommunicator.uuid!]));

        expect(serverRoom1.peers.current.value).toEqual(newPeers);
        expect(r1Room1.peers.current.value).toEqual(newPeers);
    });

    /**
     * #339: re-joining after a reconnect is `connected` flipping false then
     * true (joinCurrentRooms re-sends `inRoom` for every room) — the path
     * the production client takes after every socket drop. A reconnect
     * gets a NEW socket uuid from the server (#354), so the peer comes
     * back under a different id than it left with.
     */
    for (const [label, newUuid] of [
        ['under the same uuid', undefined],
        ['under a new uuid (a reconnected socket, #354)', 'c2-reconnected'],
    ] as const) {
        it(`a peer re-joins its rooms when it reconnects, ${label}`, () => {
            const serverRoom1 = server.join('room1');
            const r1Room1 = r1.join('room1');
            const r2Room1 = r2.join('room1');
            expect(serverRoom1.peers.current.value).toEqual(
                new Set([serverCommunicator.uuid, c1.uuid, c2.uuid]));

            // The socket drops: the server sees the peer leave.
            c2.connected.next(false);
            mockPeers.delete(c2.uuid!);
            serverCommunicator.peers.current.next(
                new Set([c1.uuid!, serverCommunicator.uuid!]));
            expect(serverRoom1.peers.current.value).toEqual(
                new Set([serverCommunicator.uuid, c1.uuid]));

            // It comes back (maybe under a new uuid) and reconnects.
            if (newUuid) {
                c2.uuid = newUuid;
            }
            mockPeers.set(c2.uuid!, c2);
            serverCommunicator.peers.current.next(new Set([
                c1.uuid!, c2.uuid!, serverCommunicator.uuid!]));
            // Nothing re-joined yet: being connected is not being in a room.
            expect(serverRoom1.peers.current.value).toEqual(
                new Set([serverCommunicator.uuid, c1.uuid]));
            c2.connected.next(true);

            expect(serverRoom1.peers.current.value).toEqual(
                new Set([serverCommunicator.uuid, c1.uuid, c2.uuid]));
            expect(r1Room1.peers.current.value).toEqual(
                new Set([serverCommunicator.uuid, c1.uuid, c2.uuid]));

            const r1Messages: { message: unknown, source: string }[] = [];
            r1Room1.messages.subscribe(m => r1Messages.push(m));
            // Through the room handle the peer held all along.
            r2Room1.sendMessage('This is a test from r2');
            expect(r1Messages).toEqual([{
                message: 'This is a test from r2',
                source: c2.uuid!,
            }]);
        });
    }
});
