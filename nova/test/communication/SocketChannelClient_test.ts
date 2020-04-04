import { SocketChannelClient } from "novajs/nova/src/communication/SocketChannelClient";
import { EngineState } from "novajs/nova/src/proto/engine_state_pb";
import { GameMessage, SocketMessageToServer } from "novajs/nova/src/proto/nova_service_pb";
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

    it("warns if it receives a message with data but no source", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const messageWithoutSource = new MessageBuilder()
            .setData(testGameMessage)
            .buildFromServer()
            .serializeBinary();

        const blob = new Blob([messageWithoutSource]);
        const messageEvent =
            new MessageEvent("testMessage", { data: blob });

        let warnPromise = new Promise((resolve) => {
            warn.and.callFake(resolve);
        });
        sendMessage(messageEvent);
        await warnPromise;

        expect(warn).toHaveBeenCalled();
        expect(warn.calls.mostRecent().args[0])
            .toMatch("with no source");
    });

    it("emits when it receives a valid message", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const message = new MessageBuilder()
            .setSource("test source")
            .setData(testGameMessage)
            .buildFromServer()
            .serializeBinary();

        const blob = new Blob([message]);
        const messageEvent =
            new MessageEvent("testMessage", { data: blob });
        const dataPromise = client.onMessage.pipe(take(1)).toPromise();

        sendMessage(messageEvent);

        const data = await dataPromise;
        expect(data.source).toEqual("test source");
        expect(data.message.toObject()).toEqual(testGameMessage.toObject());
    });

    it("server can set initial data", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const message = new MessageBuilder()
            .setSource("test source")
            .setUuid("peer 2")
            .setAdmins(["admin 1"])
            .setPeers(["admin 1", "peer 1"])
            .setData(testGameMessage)
            .buildFromServer()
            .serializeBinary();

        const connectedPeers: string[] = [];
        client.onPeerConnect.subscribe((peer) => {
            connectedPeers.push(peer);
        });

        const blob = new Blob([message]);
        const messageEvent =
            new MessageEvent("testMessage", { data: blob });

        const dataPromise = client.onMessage.pipe(take(1)).toPromise();
        sendMessage(messageEvent);

        // Wait for the message to be received.
        await dataPromise;

        expect(client.uuid).toEqual("peer 2");
        expect([...client.admins]).toEqual(["admin 1"]);
        expect([...client.peers]).toEqual(["admin 1", "peer 1"]);
        expect(connectedPeers).toEqual(["admin 1", "peer 1"]);
    });

    it("emits when peers connect or disconnect", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        // Set up initial peers
        const message1 = new MessageBuilder()
            .setSource("test source")
            .setUuid("peer 2")
            .setAdmins(["admin 1"])
            .setPeers(["admin 1", "peer 1"])
            .buildFromServer()
            .serializeBinary();

        const blob1 = new Blob([message1]);
        const messageEvent1 =
            new MessageEvent("testMessage", { data: blob1 });

        const newPeersPromise1 = client.onPeerConnect
            .pipe(take(2)).toPromise();
        sendMessage(messageEvent1);
        // Make sure the client gets the peers.
        await newPeersPromise1;

        // Make some changes to peers
        const message2 = new MessageBuilder()
            .setSource("test source")
            .addPeers(["peer 3"])
            .removePeers(["peer 1"])
            .buildFromServer()
            .serializeBinary();

        const blob2 = new Blob([message2]);
        const messageEvent2 =
            new MessageEvent("testMessage", { data: blob2 });

        const peersAdded: string[] = [];
        client.onPeerConnect.subscribe((peer) => {
            peersAdded.push(peer);
        });

        const peersRemoved: string[] = [];
        client.onPeerDisconnect.subscribe((peer) => {
            peersRemoved.push(peer);
        });

        const newPeersPromise2 = client.onPeerConnect
            .pipe(take(1)).toPromise();
        const removePeersPromise = client.onPeerDisconnect
            .pipe(take(1)).toPromise();
        sendMessage(messageEvent2);
        await newPeersPromise2;
        await removePeersPromise;

        expect(peersAdded).toEqual(["peer 3"]);
        expect(peersRemoved).toEqual(["peer 1"]);
    });

    it("sends a message to a specific client", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const messagePromise = new Promise<unknown>((resolve) => {
            webSocket.send.and.callFake(resolve);
        });

        client.send("destination uuid", testGameMessage);
        const sentMessage = await messagePromise;

        if (!(sentMessage instanceof Uint8Array)) {
            throw new Error("pongPromise was not a Uint8Array");
        }
        const deserialized = SocketMessageToServer
            .deserializeBinary(sentMessage);

        expect(deserialized.getBroadcast()).toBe(false);
        expect(deserialized.getDestination()).toEqual("destination uuid");
        expect(deserialized.getData()!.toObject())
            .toEqual(testGameMessage.toObject());
    });

    it("broadcasts a message", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const messagePromise = new Promise<unknown>((resolve) => {
            webSocket.send.and.callFake(resolve);
        });

        client.broadcast(testGameMessage);
        const sentMessage = await messagePromise;

        if (!(sentMessage instanceof Uint8Array)) {
            throw new Error("pongPromise was not a Uint8Array");
        }
        const deserialized = SocketMessageToServer
            .deserializeBinary(sentMessage);

        expect(deserialized.getBroadcast()).toBe(true);
        expect(deserialized.getDestination()).toEqual("");
        expect(deserialized.getData()!.toObject())
            .toEqual(testGameMessage.toObject());
    });

    it("replies to pings", async () => {
        const client = new SocketChannelClient({ webSocket, warn });
        let sendMessage = callbacks["message"][0];
        expect(sendMessage).toBeTruthy();

        const message = new MessageBuilder()
            .setPing(true)
            .buildFromServer()
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
        const deserialized = SocketMessageToServer.deserializeBinary(pong);
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
        const deserialized = SocketMessageToServer.deserializeBinary(ping);
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
