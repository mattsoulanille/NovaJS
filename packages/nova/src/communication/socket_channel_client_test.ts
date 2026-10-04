import * as t from "io-ts";
import { SocketChannelClient, TEXT_FRAME_CLOSE_CODE } from "./socket_channel_client.js";
import { SocketMessage } from "./socket_message.js";
import { take } from "rxjs/operators";
import { Callbacks, On, trackOn } from "./test_utils.js";
import { firstValueFrom } from "rxjs";
import { decodeWireOrThrow } from "./wire_codec.js";
import { socketCodecFor } from "./wire_schemas.js";
import { UncarriableMessageError } from "./wire_send_policy.js";
import { CommunicatorClient } from "./communicator_client.js";
import { CommunicatorMessage, MessageType } from "./communicator_message.js";
import { MultiRoom, RoomMessage } from "./multi_room_communicator.js";

/** A schema'd codec over an untyped payload: any shape, binary frames. */
const codec = socketCodecFor(t.unknown);

/** A binary frame's message event, as a browser delivers it. */
function frameEvent(message: SocketMessage): MessageEvent<ArrayBuffer> {
    const bytes = codec.encode(SocketMessage.encode(message));
    return { type: "testMessage", data: bytes.buffer } as MessageEvent<ArrayBuffer>;
}

/** What the client put on the socket, decoded. */
function sentMessage(frame: unknown): SocketMessage {
    if (!(frame instanceof Uint8Array)) {
        throw new Error(`The client sent a non-binary frame: ${String(frame)}`);
    }
    return decodeWireOrThrow(codec, SocketMessage, frame);
}

describe("SocketChannelClient", function () {
    let webSocket: jasmine.SpyObj<WebSocket>;
    let warn: jasmine.Spy<(m: string) => void>;
    let callbacks: Callbacks;
    let clock: jasmine.Clock;

    beforeEach(() => {
        clock = jasmine.clock();
        clock.install();

        webSocket = jasmine.createSpyObj<WebSocket>("webSocketSpy",
            ["addEventListener", "send", "close", "removeEventListener"], {
            CONNECTING: 0,
            OPEN: 1,
            CLOSING: 2,
            CLOSED: 3,
            readyState: 1, // OPEN
        });
        warn = jasmine.createSpy<(m: string) => void>("mockWarn");

        let on: On;
        [callbacks, on] = trackOn();
        webSocket.addEventListener.and.callFake(on);
    });
    afterEach(() => {
        clock.uninstall();
    });

    it("can be instantiated", () => {
        const client = new SocketChannelClient({ webSocket, warn, codec });
    });

    it("binds a listener to 'message'", () => {
        const client = new SocketChannelClient({ webSocket, warn, codec });
        expect(webSocket.addEventListener).toHaveBeenCalledTimes(1);
        expect(webSocket.addEventListener.calls.mostRecent().args[0])
            .toEqual("message");
    });

    it("asks for binary frames as ArrayBuffers", () => {
        new SocketChannelClient({ webSocket, warn, codec });
        expect(webSocket.binaryType).toBe('arraybuffer');
    });

    it("warns if it can't decode a received message", async () => {
        const client = new SocketChannelClient({ webSocket, warn, codec });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const messageEvent = {
            type: "testMessage",
            data: new Uint8Array([0xff, 0xff, 0x7f]).buffer,
        } as MessageEvent<ArrayBuffer>;

        let warnPromise = new Promise<void>((resolve) => {
            warn.and.callFake(() => resolve());
        });
        sendMessage(messageEvent);
        await warnPromise;

        expect(warn).toHaveBeenCalled();
        expect(warn.calls.mostRecent().args[0])
            .toMatch("Failed to deserialize");
        expect(webSocket.close).not.toHaveBeenCalled();
    });

    it("closes the socket on a TEXT frame, naming the reason", () => {
        // The wire is binary; a text frame is an older build's JSON
        // wire, and there is no fallback for it.
        const client = new SocketChannelClient({ webSocket, warn, codec });
        const received: unknown[] = [];
        client.message.subscribe(m => received.push(m));
        callbacks["message"][0]({
            type: "testMessage",
            data: JSON.stringify(SocketMessage.encode({ message: { ok: true } })),
        } as MessageEvent<string>);
        expect(received).toEqual([]);
        expect(webSocket.close).toHaveBeenCalledWith(TEXT_FRAME_CLOSE_CODE,
            jasmine.stringMatching(/text frames are not accepted.*Avro/));
        expect(warn.calls.mostRecent().args[0]).toMatch("text frame");
    });

    it("warns if the message has no body", async () => {
        const client = new SocketChannelClient({ webSocket, warn, codec });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const messageEvent = frameEvent({});

        let warnPromise = new Promise<void>((resolve) => {
            warn.and.callFake(() => resolve());
        });
        sendMessage(messageEvent);
        await warnPromise;

        expect(warn).toHaveBeenCalled();
        expect(warn.calls.mostRecent().args[0])
            .toMatch("Message had no body");
    });


    it("emits when it receives a valid message", async () => {
        const client = new SocketChannelClient({ webSocket, warn, codec });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const testMessage = {
            foo: 'foo message',
            bar: 'bar message',
        };

        const messageEvent = frameEvent({ message: testMessage });

        const messagePromise = firstValueFrom(client.message.pipe(take(1)));
        sendMessage(messageEvent);

        const messageReceived = await messagePromise;
        expect(messageReceived).toEqual(testMessage);
    });

    it("replies to pings", async () => {
        const client = new SocketChannelClient({ webSocket, warn, codec });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const messageEvent = frameEvent({ ping: true });

        const pongPromise = new Promise<unknown>((resolve) => {
            webSocket.send.and.callFake(resolve);
        });

        sendMessage(messageEvent);
        const pong = await pongPromise;
        expect(sentMessage(pong).pong).toBe(true);
    });

    it("sends a ping if it hasn't heard from the server", async () => {
        const client = new SocketChannelClient({
            webSocket,
            warn, codec,
            timeout: 10,
        });

        clock.mockDate(new Date(100));

        const pingPromise = new Promise<unknown>((resolve) => {
            webSocket.send.and.callFake(resolve);
        });

        clock.tick(11);
        const ping = await pingPromise;
        expect(sentMessage(ping).ping).toBe(true);

        clock.uninstall();
    });

    it("attempts to reconnect if there is no pong", () => {
        const webSocketFactory = jasmine.createSpy(
            'mockWebSocketFactory', () => webSocket);
        webSocketFactory.and.callThrough();

        const client = new SocketChannelClient({
            webSocket,
            warn, codec,
            timeout: 10,
            webSocketFactory,
            maxPings: 0,
        });

        clock.tick(21);

        expect(webSocket.close).toHaveBeenCalled();
        expect(webSocketFactory).toHaveBeenCalled();

        clock.uninstall();
    });

    /**
     * A socket the SERVER closed (a restart) is replaced by the next send
     * (reconnectIfClosed). `connected` must still go false before the new
     * socket's first frame raises it: that edge is what re-joins the
     * client's rooms (multi_room_communicator.ts joinCurrentRooms, #339),
     * and without it a reconnected client — under its new uuid (#354) —
     * sat in no room at all.
     */
    it("drops `connected` when it replaces a socket the server closed", () => {
        const fresh = jasmine.createSpyObj<WebSocket>("freshSocket",
            ["addEventListener", "send", "close", "removeEventListener"], {
            CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, readyState: 0,
        });
        let onFreshMessage: ((event: MessageEvent) => void) | undefined;
        fresh.addEventListener.and.callFake(((type: string,
            listener: (event: MessageEvent) => void) => {
            if (type === 'message') {
                onFreshMessage = listener;
            }
        }) as typeof fresh.addEventListener);
        const client = new SocketChannelClient({
            webSocket, warn, codec, timeout: 60_000,
            webSocketFactory: () => fresh,
        });
        const seen: boolean[] = [];
        client.connected.subscribe(value => seen.push(value));
        // The first frame raises it.
        callbacks["message"][0]!(frameEvent({ pong: true }));
        expect(client.connected.value).toBeTrue();

        // The server goes away; the browser marks the socket CLOSED.
        (Object.getOwnPropertyDescriptor(webSocket, 'readyState')!.get as
            jasmine.Spy).and.returnValue(3);
        client.send({ hello: 'again' });
        expect(client.connected.value).toBeFalse();

        onFreshMessage!(frameEvent({ pong: true }));
        expect(seen).toEqual([false, true, false, true]);
    });

    /**
     * A message the wire codec cannot encode (#272): a hard error under
     * the strict policy — the default here, NODE_ENV not being
     * production — and a dropped-with-a-warning under recover. Never
     * sent, and never the socket's problem, in either.
     */
    describe("a message the wire cannot carry", () => {
        // The opaque payload encoding has no branch for a function.
        const uncarriable = { f: () => 1 };

        it("throws under the default (strict) policy and keeps the socket", () => {
            const client = new SocketChannelClient({ webSocket, warn, codec });
            expect(() => client.send(uncarriable)).toThrowError(UncarriableMessageError,
                /Not sending a message the avro wire cannot carry/);
            expect(webSocket.send).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
            expect(webSocket.close).not.toHaveBeenCalled();

            // The next message goes out as usual.
            client.send({ ok: true });
            expect(webSocket.send).toHaveBeenCalledTimes(1);
            expect(sentMessage(webSocket.send.calls.mostRecent().args[0] as Uint8Array).message)
                .toEqual({ ok: true });
        });

        it("drops it with a warning under the recover policy", () => {
            const client = new SocketChannelClient({
                webSocket, warn, codec, sendPolicy: 'recover',
            });
            expect(() => client.send(uncarriable)).not.toThrow();
            expect(webSocket.send).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.calls.mostRecent().args[0])
                .toMatch(/Not sending a message the avro wire cannot carry/);

            client.send({ ok: true });
            expect(webSocket.send).toHaveBeenCalledTimes(1);
        });

        it("discards only that message from the queue when the socket opens", () => {
            // Queued while CONNECTING; the flush on open sends them in
            // order, and the strict throw on the second leaves the third
            // queued for the next send rather than lost or re-sent.
            const connecting = jasmine.createSpyObj<WebSocket>("connectingSpy",
                ["addEventListener", "send", "close", "removeEventListener"], {
                CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
            });
            let readyState = 0;
            Object.defineProperty(connecting, 'readyState', { get: () => readyState });
            const client = new SocketChannelClient({ webSocket: connecting, warn, codec });
            client.send({ first: true });
            client.send(uncarriable);
            client.send({ third: true });
            expect(connecting.send).not.toHaveBeenCalled();

            readyState = 1;
            expect(() => client.send({ fourth: true })).toThrowError(UncarriableMessageError);
            expect(connecting.send).toHaveBeenCalledTimes(1);
            expect(sentMessage(connecting.send.calls.argsFor(0)[0] as Uint8Array).message)
                .toEqual({ first: true });

            client.send({ fifth: true });
            expect(connecting.send).toHaveBeenCalledTimes(4);
            expect(connecting.send.calls.allArgs().map(([frame]) =>
                sentMessage(frame as Uint8Array).message))
                .toEqual([{ first: true }, { third: true }, { fourth: true }, { fifth: true }]);
        });
    });

    /**
     * A browser WebSocket, as far as the client can tell: a socket is
     * CONNECTING until the handshake completes, `send` throws on one that
     * is not OPEN (so the client must queue), and a half-open socket
     * stays OPEN while nothing it sends arrives anywhere.
     */
    class BrowserLikeSocket {
        readonly CONNECTING = 0;
        readonly OPEN = 1;
        readonly CLOSING = 2;
        readonly CLOSED = 3;
        readyState = 0;
        binaryType = 'blob';
        /** Every frame written to this socket, decoded, in order. */
        readonly written: SocketMessage[] = [];
        private listeners = new Map<string, Set<(event: unknown) => void>>();

        addEventListener(type: string, listener: (event: unknown) => void,
            options?: { once?: boolean }) {
            const wrapped = options?.once
                ? (event: unknown) => {
                    this.removeEventListener(type, wrapped);
                    listener(event);
                }
                : listener;
            if (!this.listeners.has(type)) {
                this.listeners.set(type, new Set());
            }
            this.listeners.get(type)!.add(wrapped);
        }
        removeEventListener(type: string, listener: (event: unknown) => void) {
            this.listeners.get(type)?.delete(listener);
        }
        private dispatch(type: string, event: unknown) {
            for (const listener of [...this.listeners.get(type) ?? []]) {
                listener(event);
            }
        }
        send(frame: unknown) {
            if (this.readyState !== this.OPEN) {
                throw new Error('InvalidStateError: the socket is not open');
            }
            this.written.push(sentMessage(frame));
        }
        close() {
            this.readyState = this.CLOSED;
        }
        /** The handshake completes. */
        open() {
            this.readyState = this.OPEN;
            this.dispatch('open', {});
        }
        /** A frame from the server end. */
        receive(message: SocketMessage) {
            this.dispatch('message', frameEvent(message));
        }
        /** The communicator frames written, decoded. */
        communicatorFrames(): CommunicatorMessage[] {
            return this.written.filter(frame => frame.message !== undefined)
                .map(frame => {
                    const decoded = CommunicatorMessage.decode(frame.message);
                    if (decoded._tag === 'Left') {
                        throw new Error('not a communicator frame');
                    }
                    return decoded.right;
                });
        }
    }

    function uuidFrame(uuid: string, token: string): SocketMessage {
        return {
            message: CommunicatorMessage.encode({
                type: MessageType.uuid, uuid, servers: new Set(['server']), token,
            }),
        };
    }

    /** The server's announcement of a room's peer set. */
    function roomPeersFrame(room: string, peers: string[]): SocketMessage {
        return {
            message: CommunicatorMessage.encode({
                type: MessageType.message, source: 'server',
                message: RoomMessage.encode({ room, peers: new Set(peers) }),
            }),
        };
    }

    const tokenFrame = (token: string): CommunicatorMessage =>
        ({ type: MessageType.reconnect, token });

    /** The room payloads among communicator frames (joins excluded). */
    function roomPayloads(frames: CommunicatorMessage[]): unknown[] {
        return frames.flatMap(frame => frame.type === MessageType.message
            && (frame.message as { message?: unknown }).message !== undefined
            ? [(frame.message as { message: unknown }).message] : []);
    }

    /**
     * #366: the reconnect token (#354) must be the new connection's FIRST
     * communicator frame — the only position the server honours it in
     * (communicator_server.ts). While the socket is down the client keeps
     * pinging and the simulation keeps sending room traffic; what the
     * browser path QUEUED of that went out on the new socket AHEAD of the
     * token, so the server ignored it ("presented a reconnect token after
     * its first frame") and the half-open old connection stayed in the
     * room until the server's keepalive noticed, about a minute later.
     * The older specs' sockets queued nothing while disconnected, so they
     * never saw it.
     */
    describe("after a lost connection (#366)", () => {
        const TIMEOUT = 100;
        let sockets: BrowserLikeSocket[];
        let client: SocketChannelClient;
        let communicator: CommunicatorClient;
        let room: ReturnType<MultiRoom['join']>;

        beforeEach(() => {
            spyOn(console, 'warn');
            sockets = [];
            client = new SocketChannelClient({
                webSocketFactory: () => {
                    const socket = new BrowserLikeSocket();
                    sockets.push(socket);
                    return socket as unknown as WebSocket;
                },
                warn, codec, timeout: TIMEOUT, maxPings: 3,
            });
            communicator = new CommunicatorClient(client);
            room = new MultiRoom(communicator).join('nova:129');
            // The first connection: up, announced, in the room.
            sockets[0].open();
            sockets[0].receive(uuidFrame('first', 'first token'));
            sockets[0].receive(roomPeersFrame('nova:129', ['server', 'first']));
            expect(communicator.uuid).toBe('first');
            room.sendMessage({ before: 'the drop' });
            expect(roomPayloads(sockets[0].communicatorFrames()))
                .toEqual([{ before: 'the drop' }]);
        });

        afterEach(() => {
            client.disconnect();
        });

        /** The link goes half-open: the old socket stays OPEN, nothing
         * arrives either way, and the keepalive gives up on it. Every
         * replacement socket's handshake then hangs for the rest of the
         * outage (the keepalive abandons each for another), while the
         * keepalive keeps pinging and the simulation keeps sending room
         * traffic. Returns the replacement that finally connects. */
        function outage(): BrowserLikeSocket {
            sockets[0].send = () => undefined;
            for (let i = 0; i < 10 && sockets.length === 1; i++) {
                room.sendMessage({ during: 'the half-open', i });
                clock.tick(TIMEOUT + 1);
            }
            expect(sockets.length).withContext('the keepalive reconnected')
                .toBeGreaterThan(1);
            expect(client.connected.value).toBeFalse();
            for (let i = 0; i < 4; i++) {
                room.sendMessage({ during: 'the outage', i });
                clock.tick(TIMEOUT + 1);
            }
            // Abandoned before their handshakes completed: nothing written.
            for (const abandoned of sockets.slice(1, -1)) {
                expect(abandoned.written).toEqual([]);
            }
            return sockets[sockets.length - 1];
        }

        it("opens the new connection with the token, ahead of anything queued during the outage", () => {
            const fresh = outage();
            fresh.open();
            fresh.receive(uuidFrame('second', 'second token'));

            // The very first frame on the socket, pings included.
            expect(fresh.written[0]?.message)
                .toEqual(CommunicatorMessage.encode(tokenFrame('first token')));
            // Exactly once on this connection.
            expect(fresh.communicatorFrames()
                .filter(frame => frame.type === MessageType.reconnect) as unknown[])
                .toEqual([tokenFrame('first token')]);
            // The client now holds the new connection's token.
            expect(communicator['reconnectToken']).toBe('second token');
        });

        it("sends the token as soon as the socket opens, before the server's first frame", () => {
            const fresh = outage();
            fresh.open();
            expect(fresh.written.map(frame => frame.message))
                .toEqual([CommunicatorMessage.encode(tokenFrame('first token'))]);
        });

        it("drops what was queued for the dead connection: no burst of stale pings, no stale room traffic", () => {
            const fresh = outage();
            fresh.open();
            fresh.receive(uuidFrame('second', 'second token'));
            room.sendMessage({ after: 'the reconnect' });

            expect(fresh.written.filter(frame => frame.ping).length)
                .withContext('pings replayed from the outage').toBe(0);
            // Room traffic from the outage was addressed as a peer (the old
            // uuid) the new connection is not, to a room it has not joined
            // yet: dropped. The re-join, and what follows it, go out.
            const frames = fresh.communicatorFrames();
            expect(roomPayloads(frames)).toEqual([{ after: 'the reconnect' }]);
            const joins = frames.filter(frame => frame.type === MessageType.message
                && (frame.message as { inRoom?: boolean }).inRoom === true);
            expect(joins.length).withContext('the connected edge re-joins').toBe(1);
        });

        it("presents the token on whichever replacement socket finally connects", () => {
            outage();
            // More abandoned replacements, then one connects.
            const before = sockets.length;
            for (let i = 0; i < 10 && sockets.length === before; i++) {
                clock.tick(TIMEOUT + 1);
            }
            expect(sockets.length).toBeGreaterThan(before);
            const fresh = sockets[sockets.length - 1];
            fresh.open();
            fresh.receive(uuidFrame('third', 'third token'));
            for (const abandoned of sockets.slice(1, -1)) {
                expect(abandoned.written).toEqual([]);
            }
            expect(fresh.communicatorFrames()[0]).toEqual(tokenFrame('first token'));
        });

        it("presents nothing when the connection it lost never received a token", () => {
            communicator['reconnectToken'] = undefined;
            const fresh = outage();
            fresh.open();
            fresh.receive(uuidFrame('second', 'second token'));
            expect(fresh.communicatorFrames()
                .filter(frame => frame.type === MessageType.reconnect)).toEqual([]);
        });
    });

    it("keeps the queue of a FIRST connection: nothing to drop before any connection existed", () => {
        const created: BrowserLikeSocket[] = [];
        const client = new SocketChannelClient({
            webSocketFactory: () => {
                const socket = new BrowserLikeSocket();
                created.push(socket);
                return socket as unknown as WebSocket;
            },
            warn, codec, timeout: 100, maxPings: 0,
        });
        client.send({ early: 1 });
        // The first socket never connects; the keepalive replaces it.
        clock.tick(250);
        expect(created.length).toBeGreaterThan(1);
        client.send({ early: 2 });
        const socket = created[created.length - 1];
        socket.open();
        socket.receive({ pong: true });
        client.send({ late: 3 });
        expect(socket.written.filter(frame => frame.message !== undefined)
            .map(frame => frame.message))
            .toEqual([{ early: 1 }, { early: 2 }, { late: 3 }]);
        client.disconnect();
    });
});
