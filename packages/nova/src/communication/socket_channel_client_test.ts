import * as t from "io-ts";
import { SocketChannelClient, TEXT_FRAME_CLOSE_CODE } from "./socket_channel_client.js";
import { SocketMessage } from "./socket_message.js";
import { take } from "rxjs/operators";
import { Callbacks, On, trackOn } from "./test_utils.js";
import { firstValueFrom } from "rxjs";
import { decodeWireOrThrow } from "./wire_codec.js";
import { socketCodecFor } from "./wire_schemas.js";

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
});
