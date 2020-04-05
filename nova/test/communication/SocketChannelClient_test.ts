import { SocketChannelClient } from "novajs/nova/src/communication/SocketChannelClient";
import { EngineState } from "novajs/nova/src/proto/engine_state_pb";
import { GameMessage, SocketMessage } from "novajs/nova/src/proto/nova_service_pb";
import { take } from "rxjs/operators";
import { Callbacks, MessageBuilder, On, trackOn } from "./test_utils";

const testGameMessage = new GameMessage();
const testEngineState = new EngineState();
testEngineState.setSystemskeysList(["foo", "bar", "baz"]);
testGameMessage.setEnginestate(testEngineState);

describe("SocketChannelClient", function() {

    let webSocket: jasmine.SpyObj<WebSocket>;
    let warn: jasmine.Spy<(m: string) => void>;
    let callbacks: Callbacks;
    beforeEach(() => {
        webSocket = jasmine.createSpyObj<WebSocket>("webSocketSpy", ["addEventListener", "send", "close", "removeEventListener"]);
        warn = jasmine.createSpy<(m: string) => void>("mockWarn");

        let on: On;
        [callbacks, on] = trackOn();
        webSocket.addEventListener.and.callFake(on);
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

    it("warns if the MessageEvent is not a Blob", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const bogusMessage = "badmessage";
        const messageEvent =
            new MessageEvent("testMessage", { data: bogusMessage });

        let warnPromise = new Promise((resolve) => {
            warn.and.callFake(resolve);
        });

        sendMessage(messageEvent);
        await warnPromise;

        expect(warn).toHaveBeenCalled();
        expect(warn.calls.mostRecent().args[0])
            .toMatch("Expected data to be a Blob");

    });

    it("warns if it can't decode a received message", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const blob = new Blob([new Uint8Array([1, 2, 0]).buffer]);
        const messageEvent =
            new MessageEvent("testMessage", { data: blob });

        let warnPromise = new Promise((resolve) => {
            warn.and.callFake(resolve);
        });
        sendMessage(messageEvent);
        await warnPromise;

        expect(warn).toHaveBeenCalled();
        expect(warn.calls.mostRecent().args[0])
            .toMatch("Failed to deserialize");
    });

    it("emits when it receives a valid message", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const message = new MessageBuilder()
            .setData(testGameMessage)
            .build()
            .serializeBinary();

        const blob = new Blob([message]);
        const messageEvent =
            new MessageEvent("testMessage", { data: blob });
        const messagePromise = client.message.pipe(take(1)).toPromise();

        sendMessage(messageEvent);

        const messageReceived = await messagePromise;
        expect(messageReceived.toObject())
            .toEqual(testGameMessage.toObject());
    });

    it("replies to pings", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const message = new MessageBuilder()
            .setPing(true)
            .build()
            .serializeBinary();

        const blob = new Blob([message]);
        const messageEvent =
            new MessageEvent("testMessage", { data: blob });

        const pongPromise = new Promise<unknown>((resolve) => {
            webSocket.send.and.callFake(resolve);
        });

        sendMessage(messageEvent);
        const pong = await pongPromise;
        if (!(pong instanceof Uint8Array)) {
            throw new Error("pongPromise was not a Uint8Array");
        }
        const deserialized = SocketMessage.deserializeBinary(pong);
        expect(deserialized.getPong()).toBe(true);
    });

    it("sends a ping if it hasn't heard from the server", async () => {
        jasmine.clock().install();

        const client = new SocketChannelClient({
            webSocket,
            warn,
            timeout: 10,
        });

        const pingPromise = new Promise<unknown>((resolve) => {
            webSocket.send.and.callFake(resolve);
        });

        jasmine.clock().tick(11);

        const ping = await pingPromise;
        if (!(ping instanceof Uint8Array)) {
            throw new Error("pingPromise was not a Uint8Array");
        }
        const deserialized = SocketMessage.deserializeBinary(ping);
        expect(deserialized.getPing()).toBe(true);

        jasmine.clock().uninstall();
    });

    it("attempts to reconnect if there is no pong", () => {
        jasmine.clock().install();
        (webSocket as any).readyState = WebSocket.OPEN;
        const client = new SocketChannelClient({
            webSocket,
            warn,
            timeout: 10,
        });
        debugger;
        jasmine.clock().tick(21);

        expect(webSocket.close).toHaveBeenCalled();

        jasmine.clock().uninstall();
    });
});
