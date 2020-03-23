import "jasmine";
import { SocketChannelServer } from "novajs/nova/src/communication/SocketChannelServer";
import * as WebSocket from "ws";
import { IncomingMessage } from "http";
import * as http from "http";
import * as uuid from "uuid/v4";
import { ManagementData, RepeatedString, StringValue, SocketMessageFromServer, StringSetDelta } from "novajs/nova/src/proto/nova_service_pb";


type Callbacks = { [event: string]: ((...args: unknown[]) => unknown)[] };
type On = (event: string, cb: (...args: any[]) => unknown) => any;
function trackOn(): [Callbacks, On] {
    let callbacks: Callbacks = {}

    function on(event: string, cb: (...args: unknown[]) => unknown) {

        if (!callbacks[event]) {
            callbacks[event] = [];
        }
        callbacks[event].push(cb);
    }
    return [callbacks, on]
}

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
        const client1 = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on", "send"]);
        const [client1Callbacks, client1On] = trackOn();
        client1.on.and.callFake(client1On);
        wssCallbacks["connection"][0](client1);
        const client1Uuid = [...server.peers][0];

        const client2 = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on"]);
        wssCallbacks["connection"][0](client2);

        const uuids = [...server.peers];
        expect(uuids[0]).toEqual(client1Uuid);
        const client2Uuid = uuids[1];

        const client1Message = new MessageBuilder()
            .setAdmins([server.uuid])
            .setPeers([client2Uuid, server.uuid])
            .setUuid(client1Uuid)
            .build();

        client1.readyState = WebSocket.OPEN;
        client1Callbacks["open"][0]();

        expect(client1.send).toHaveBeenCalledTimes(1);

        expect(SocketMessageFromServer.deserializeBinary(
            client1.send.calls.mostRecent().args[0]))
            .toEqual(client1Message);
    });

    it("reports new peers to existing clients", () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on", "send"]);
        const [client1Callbacks, client1On] = trackOn();
        client1.on.and.callFake(client1On);
        wssCallbacks["connection"][0](client1);
        const client1Uuid = [...server.peers][0];
        client1.readyState = WebSocket.OPEN;
        client1Callbacks["open"][0]();


        // Connect client 2
        const client2 = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on", "send"]);
        const [client2Callbacks, client2On] = trackOn();
        client2.on.and.callFake(client2On);
        wssCallbacks["connection"][0](client2);
        client2.readyState = WebSocket.OPEN;
        const uuids = [...server.peers];
        expect(uuids[0]).toEqual(client1Uuid);
        const client2Uuid = uuids[1];
        client2Callbacks["open"][0]();

        // Expected message reporting client2's connection to client1
        const client1Message = new MessageBuilder()
            .addPeers([client2Uuid])
            .build();

        // First call is for the initial onconnection data
        // Second is to report that client2 connected
        expect(client1.send).toHaveBeenCalledTimes(2);

        expect(SocketMessageFromServer.deserializeBinary(
            client1.send.calls.mostRecent().args[0]))
            .toEqual(client1Message);
    });

    it("reports disconnecting peers to existing peers", () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on", "send"]);
        const [client1Callbacks, client1On] = trackOn();
        client1.on.and.callFake(client1On);
        wssCallbacks["connection"][0](client1);
        const client1Uuid = [...server.peers][0];
        client1.readyState = WebSocket.OPEN;
        client1Callbacks["open"][0]();


        // Connect client 2
        const client2 = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on", "send", "close"]);
        const [client2Callbacks, client2On] = trackOn();
        client2.on.and.callFake(client2On);
        wssCallbacks["connection"][0](client2);
        client2.readyState = WebSocket.OPEN;
        const uuids = [...server.peers];
        expect(uuids[0]).toEqual(client1Uuid);
        const client2Uuid = uuids[1];
        client2Callbacks["open"][0]();

        // Disconnect client 2
        client2Callbacks["close"][0]()

        // Expected message reporting client2's connection to client1
        const client1Message = new MessageBuilder()
            .removePeers([client2Uuid])
            .setBroadcast(true)
            .build();

        // First call is for the initial onconnection data
        // Second is to report that client2 connected
        // Third is to report that client2 disconnected
        expect(client1.send).toHaveBeenCalledTimes(3);

        expect(SocketMessageFromServer.deserializeBinary(
            client1.send.calls.mostRecent().args[0]))
            .toEqual(client1Message);
    });
});

class MessageBuilder {
    private readonly management = new ManagementData();
    private broadcast?: boolean = undefined;

    setBroadcast(broadcast: boolean) {
        this.broadcast = broadcast;
        return this;
    }

    addPeers(peersList: string[]) {
        const delta = new StringSetDelta();
        delta.setAddList(peersList);
        this.management.setPeersdelta(delta);
        return this;
    }

    removePeers(peersList: string[]) {
        const delta = new StringSetDelta();
        delta.setRemoveList(peersList);
        this.management.setPeersdelta(delta);
        return this;
    }

    setPeers(peersList: string[]) {
        const peers = new RepeatedString();
        peers.setValueList(peersList);
        this.management.setPeers(peers);
        return this;
    }

    setAdmins(adminsList: string[]) {
        const admins = new RepeatedString();
        admins.setValueList(adminsList);
        this.management.setAdmins(admins);
        return this;
    }

    setUuid(uuidString: string) {
        const uuid = new StringValue();
        uuid.setValue(uuidString);
        this.management.setUuid(uuid);
        return this;
    }

    build() {
        const message = new SocketMessageFromServer();
        message.setManagementdata(this.management);
        if (this.broadcast !== undefined) {
            message.setBroadcast(this.broadcast);
        }
        return message;
    }
}
