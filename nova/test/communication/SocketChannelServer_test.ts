import * as http from "http";
import "jasmine";
import { SocketChannelServer } from "novajs/nova/src/communication/SocketChannelServer";
import { GameMessage, SocketMessageFromServer, SocketMessageToServer } from "novajs/nova/src/proto/nova_service_pb";
import * as WebSocket from "ws";
import { Callbacks, MessageBuilder, On, trackOn } from "./test_utils";
import { take } from "rxjs/operators";
import { Subject } from "rxjs";
import { EngineState } from "novajs/nova/src/proto/engine_state_pb";

const testGameMessage = new GameMessage();
const testEngineState = new EngineState();
testEngineState.setSystemskeysList(["foo", "bar", "baz"]);
testGameMessage.setEnginestate(testEngineState);

describe("SocketChannelServer", function() {

    let wss: jasmine.SpyObj<WebSocket.Server>;
    let wssCallbacks: Callbacks;

    beforeEach(() => {
        wss = jasmine.createSpyObj<WebSocket.Server>("WebSocket.Server Spy", ["on"]);
        let on: On;
        [wssCallbacks, on] = trackOn();
        wss.on.and.callFake(on);
    });

    it("should be created", () => {
        const server = new SocketChannelServer({
            wss
        });
        expect(server).toBeDefined();
    });

    it("binds to the `upgrade` event on the http server", () => {
        const httpServer =
            jasmine.createSpyObj<http.Server>("http.Server Spy", ["on"]);

        const [callbacks, on] = trackOn();
        httpServer.on.and.callFake(on);
        new SocketChannelServer({
            httpServer
        });

        expect(callbacks["upgrade"].length).toBe(1);
    });

    it("binds to the websocket's `connection` listener", () => {
        new SocketChannelServer({
            wss
        });

        expect(wss.on).toHaveBeenCalled();
        expect(wss.on.calls.mostRecent().args[0]).toBe("connection");
    });

    it("binds listeners to a peer's socket", () => {
        new SocketChannelServer({
            wss
        });

        const webSocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on"]);
        const [webSocketCallbacks, on] = trackOn();
        webSocket.on.and.callFake(on);

        expect(wssCallbacks["connection"][0]).toBeDefined();
        wssCallbacks["connection"][0](webSocket);

        expect(webSocketCallbacks["open"].length).toBe(1);
        expect(webSocketCallbacks["message"].length).toBe(1);
        expect(webSocketCallbacks["close"].length).toBe(1);
    });

    it("creates a entry for a new client in the peers set", () => {
        const server = new SocketChannelServer({
            wss
        });
        const webSocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on"]);
        const [webSocketCallbacks, on] = trackOn();
        webSocket.on.and.callFake(on);
        wssCallbacks["connection"][0](webSocket);

        const uuids = [...server.peers];
        expect(uuids.length).toBe(1);
    });

    it("sends initial data when a new client opens", () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.peers][0];
        client1.open();

        // Connect client 2
        const client2 = new ClientHarness(server);
        wssCallbacks["connection"][0](client2.websocket);
        const uuids = [...server.peers];
        expect(uuids[0]).toEqual(client1Uuid);
        const client2Uuid = uuids[1];
        client2.open();

        // Check the message sent to client2
        const client2Message = new MessageBuilder()
            .setAdmins([server.uuid])
            .setPeers([client1Uuid, server.uuid])
            .setUuid(client2Uuid)
            .buildFromServer();

        expect(client2.websocket.send).toHaveBeenCalledTimes(1);

        expect(SocketMessageFromServer.deserializeBinary(
            client2.websocket.send.calls.mostRecent().args[0]))
            .toEqual(client2Message);
    });

    it("emits when a peer connects", async () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.peers][0];

        const peerConnectPromise = server.onPeerConnect
            .pipe(take(1)).toPromise();

        client1.open();

        const peerConnect = await peerConnectPromise;
        expect(peerConnect).toEqual(client1Uuid);
    });

    it("reports new peers to existing clients", () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.peers][0];
        client1.open();

        // Connect client 2
        const client2 = new ClientHarness(server);
        wssCallbacks["connection"][0](client2.websocket);
        const uuids = [...server.peers];
        expect(uuids[0]).toEqual(client1Uuid);
        const client2Uuid = uuids[1];
        client2.open();

        // Expected message reporting client2's connection to client1
        const client1Message = new MessageBuilder()
            .addPeers([client2Uuid])
            .buildFromServer();

        // First call is for the initial onconnection data
        // Second is to report that client2 connected
        expect(client1.websocket.send).toHaveBeenCalledTimes(2);

        expect(SocketMessageFromServer.deserializeBinary(
            client1.websocket.send.calls.mostRecent().args[0]))
            .toEqual(client1Message);
    });

    it("emits when a peer disconnects", async () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.peers][0];
        client1.open();

        const peerDisconnectPromise = server.onPeerDisconnect
            .pipe(take(1)).toPromise();

        client1.close();

        const peerDisconnect = await peerDisconnectPromise;
        expect(peerDisconnect).toEqual(client1Uuid);
    });

    it("reports disconnecting peers to existing peers", () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.peers][0];
        client1.open();

        // Connect client 2
        const client2 = new ClientHarness(server);
        wssCallbacks["connection"][0](client2.websocket);

        const uuids = [...server.peers];
        expect(uuids[0]).toEqual(client1Uuid);
        const client2Uuid = uuids[1];
        client2.open();

        // Disconnect client 2
        client2.close();

        // Expected message reporting client2's connection to client1
        const client1Message = new MessageBuilder()
            .removePeers([client2Uuid])
            .setBroadcast(true)
            .buildFromServer();

        // First call is for the initial onconnection data
        // Second is to report that client2 connected
        // Third is to report that client2 disconnected
        expect(client1.websocket.send).toHaveBeenCalledTimes(3);

        expect(SocketMessageFromServer.deserializeBinary(
            client1.websocket.send.calls.mostRecent().args[0]))
            .toEqual(client1Message);
    });

    it("send() sends a message to a peer", () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.peers][0];
        client1.open();

        server.send(client1Uuid, testGameMessage);

        expect(client1.lastMessage!.getData()!.toObject())
            .toEqual(testGameMessage.toObject());
        expect(client1.lastMessage!.getSource())
            .toEqual(server.uuid);
    });

    it("emits messages addressed to the server", async () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.peers][0];
        client1.open();

        const message = new MessageBuilder()
            .setData(testGameMessage)
            .setDestination(server.uuid)
            .buildToServer();


        const serverEmitsPromise = server.onMessage
            .pipe(take(1))
            .toPromise();

        client1.sendMessage(message);

        const serverEmits = await serverEmitsPromise;
        //console.log(serverEmits.message.toObject());

        expect(serverEmits.message.toObject()).toEqual(testGameMessage.toObject());
        expect(serverEmits.source).toEqual(client1Uuid);
    });

    it("forwards messages addressed to another peer", async () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.peers][0];
        client1.open();

        // Connect client 2
        const client2 = new ClientHarness(server);
        wssCallbacks["connection"][0](client2.websocket);
        expect([...server.peers][0]).toEqual(client1Uuid);
        const client2Uuid = [...server.peers][1];
        client2.open();

        const messageToServer = new MessageBuilder()
            .setData(testGameMessage)
            .setDestination(client2Uuid)
            .buildToServer();

        client1.sendMessage(messageToServer);

        expect(client2.lastMessage!.getData()!.toObject())
            .toEqual(testGameMessage.toObject());
        expect(client2.lastMessage!.getSource()).toEqual(client1Uuid);
    });

    it("broadcast() broadcasts a message to all peers", () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        client1.open();

        // Connect client 2
        const client2 = new ClientHarness(server);
        wssCallbacks["connection"][0](client2.websocket);
        client2.open();

        server.broadcast(testGameMessage);

        expect(client1.lastMessage!.getData()!.toObject())
            .toEqual(testGameMessage.toObject());
        expect(client1.lastMessage!.getSource())
            .toEqual(server.uuid);

        expect(client2.lastMessage!.getData()!.toObject())
            .toEqual(testGameMessage.toObject());
        expect(client2.lastMessage!.getSource())
            .toEqual(server.uuid);
    });

    it("emits and forwards when a peer broadcasts", async () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.peers][0];
        client1.open();

        // Connect client 2
        const client2 = new ClientHarness(server);
        wssCallbacks["connection"][0](client2.websocket);
        client2.open();

        const messageToServer = new MessageBuilder()
            .setData(testGameMessage)
            .setBroadcast(true)
            .buildToServer();

        const serverReceivesMessagePromise = server.onMessage.pipe(take(1)).toPromise();
        client1.sendMessage(messageToServer);
        const serverReceivedMessage = await serverReceivesMessagePromise;

        expect(client2.lastMessage!.getData()!.toObject())
            .toEqual(testGameMessage.toObject());
        expect(client2.lastMessage!.getSource()).toEqual(client1Uuid);

        expect(serverReceivedMessage.message.toObject())
            .toEqual(testGameMessage.toObject());
        expect(serverReceivedMessage.source).toEqual(client1Uuid);
    });
});

class ClientHarness {
    readonly websocket: jasmine.SpyObj<WebSocket>;
    readonly callbacks: Callbacks;
    readonly messagesFromServer = new Subject<SocketMessageFromServer>();
    lastMessage?: SocketMessageFromServer;

    constructor(private server: SocketChannelServer) {
        this.websocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on", "send"]);
        const [callbacks, on] = trackOn();
        this.websocket.on.and.callFake(on);
        this.callbacks = callbacks;
        this.websocket.send.and.callFake((data: any) => {
            const deserialized =
                SocketMessageFromServer.deserializeBinary(data);
            this.messagesFromServer.next(deserialized);
            this.lastMessage = deserialized;
        });
    }
    open() {
        this.websocket.readyState = WebSocket.OPEN;
        this.callbacks["open"][0]();
    }
    close() {
        this.websocket.readyState = WebSocket.CLOSING;
        this.callbacks["close"][0]();
        this.websocket.readyState = WebSocket.CLOSED;
    }
    sendMessage(message: SocketMessageToServer) {
        this.callbacks["message"][0](message.serializeBinary());
    }
}
