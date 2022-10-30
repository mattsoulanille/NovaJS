import { isLeft } from "fp-ts/Either";
import { SocketChannelClient } from "./SocketChannelClient";
import { SocketMessage } from "./SocketMessage";
import { take } from "rxjs/operators";
import { Callbacks, On, trackOn } from "./test_utils";

describe("SocketChannelClient", function() {
    let webSocket: jasmine.SpyObj<WebSocket>;
    let warn: jasmine.Spy<(m: string) => void>;
    let callbacks: Callbacks;
    let clock: jasmine.Clock;

    beforeEach(() => {
        clock = jasmine.clock();
        clock.install();

        webSocket = jasmine.createSpyObj<WebSocket>("webSocketSpy",
            ["addEventListener", "send", "close", "removeEventListener"], {
            OPEN: 1,
            CLOSED: 2,
            CLOSING: 3,
            CONNECTING: 4,
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
        const client = new SocketChannelClient({ webSocket, warn });
    });

    it("binds a listener to 'message'", () => {
        const client = new SocketChannelClient({ webSocket, warn });
        expect(webSocket.addEventListener).toHaveBeenCalledTimes(1);
        expect(webSocket.addEventListener.calls.mostRecent().args[0])
            .toEqual("message");
    });

    it("warns if it can't decode a received message", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const badMessage = "foobar";
        const messageEvent = {
            type: "testMessage",
            data: JSON.stringify(badMessage)
        } as MessageEvent<string>;

        let warnPromise = new Promise((resolve) => {
            warn.and.callFake(resolve);
        });
        sendMessage(messageEvent);
        await warnPromise;

        expect(warn).toHaveBeenCalled();
        expect(warn.calls.mostRecent().args[0])
            .toMatch("Failed to deserialize");
    });

    it("warns if the message has no body", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const badMessage = { foo: 'bar' };
        const messageEvent = {
            type: "testMessage",
            data: JSON.stringify(badMessage)
        } as MessageEvent<string>;

        let warnPromise = new Promise((resolve) => {
            warn.and.callFake(resolve);
        });
        sendMessage(messageEvent);
        await warnPromise;

        expect(warn).toHaveBeenCalled();
        expect(warn.calls.mostRecent().args[0])
            .toMatch("Message had no body");
    });


    it("emits when it receives a valid message", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const testMessage = {
            foo: 'foo message',
            bar: 'bar message',
        };

        const message = SocketMessage.encode({ message: testMessage });
        const messageEvent = {
            type: "testMessage",
            data: JSON.stringify(message)
        } as MessageEvent<string>;

        const messagePromise = client.message.pipe(take(1)).toPromise();
        sendMessage(messageEvent);

        const messageReceived = await messagePromise;
        expect(messageReceived).toEqual(testMessage);
    });

    it("replies to pings", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const message = SocketMessage.encode({ ping: true });
        const messageEvent = {
            type: "testMessage",
            data: JSON.stringify(message),
        } as MessageEvent<string>;

        const pongPromise = new Promise<unknown>((resolve) => {
            webSocket.send.and.callFake(resolve);
        });

        sendMessage(messageEvent);
        const pong = await pongPromise;
        const pongMessage = SocketMessage.decode(JSON.parse(pong as string) as unknown);
        if (isLeft(pongMessage)) {
            throw new Error("pongPromise was not a SocketMessage");
        }
        expect(pongMessage.right.pong).toBe(true);
    });

    it("sends a ping if it hasn't heard from the server", async () => {
        const client = new SocketChannelClient({
            webSocket,
            warn,
            timeout: 10,
        });

        clock.mockDate(new Date(100));

        const pingPromise = new Promise<unknown>((resolve) => {
            webSocket.send.and.callFake(resolve);
        });

        clock.tick(11);
        const ping = await pingPromise;
        const pingMessage = SocketMessage.decode(JSON.parse(ping as string) as unknown);
        if (isLeft(pingMessage)) {
            throw new Error("pingPromise was not a SocketMessage");
        }
        expect(pingMessage.right.ping).toBe(true);

        clock.uninstall();
    });

    it("attempts to reconnect if there is no pong", () => {
        const webSocketFactory = jasmine.createSpy(
            'mockWebSocketFactory', () => webSocket);
        webSocketFactory.and.callThrough();

        const client = new SocketChannelClient({
            webSocket,
            warn,
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
