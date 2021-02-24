import { isLeft } from "fp-ts/lib/Either";
import * as https from "https";
import * as http from "http";
import "jasmine";
import { SocketChannelServer } from "novajs/nova/src/communication/SocketChannelServer";
import { SocketMessage } from "novajs/nova/src/communication/SocketMessage";
import { Subject } from "rxjs";
import { take } from "rxjs/operators";
import * as WebSocket from "ws";
import { Callbacks, On, trackOn } from "./test_utils";

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
        const httpsServer =
            jasmine.createSpyObj<https.Server>("http.Server Spy", ["on"]);

        const [callbacks, on] = trackOn();
        httpsServer.on.and.callFake(on);
        new SocketChannelServer({
            server: httpsServer
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

    it("binds listeners to a client's socket", () => {
        new SocketChannelServer({
            wss
        });

        const webSocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on"]);
        const [webSocketCallbacks, on] = trackOn();
        webSocket.on.and.callFake(on);
        webSocket.readyState = WebSocket.CONNECTING;

        expect(wssCallbacks["connection"][0]).toBeDefined();
        wssCallbacks["connection"][0](webSocket);

        expect(webSocketCallbacks["open"].length).toBe(1);
        expect(webSocketCallbacks["message"].length).toBe(1);
        expect(webSocketCallbacks["close"].length).toBe(1);
    });

    it("creates an entry for a new client in the clients set", () => {
        const server = new SocketChannelServer({
            wss
        });
        const webSocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on"]);
        const [webSocketCallbacks, on] = trackOn();
        webSocket.on.and.callFake(on);
        webSocket.readyState = WebSocket.CONNECTING;
        wssCallbacks["connection"][0](webSocket);

        const uuids = [...server.clients];
        expect(uuids.length).toBe(1);
    });

    it("emits when a client connects", async () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.clients][0];

        const peerConnectPromise = server.clientConnect
            .pipe(take(1)).toPromise();

        client1.open();

        const peerConnect = await peerConnectPromise;
        expect(peerConnect).toEqual(client1Uuid);
    });

    it("emits when a client disconnects", async () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.clients][0];
        client1.open();

        const peerDisconnectPromise = server.clientDisconnect
            .pipe(take(1)).toPromise();

        client1.close();

        const peerDisconnect = await peerDisconnectPromise;
        expect(peerDisconnect).toEqual(client1Uuid);
    });

    it("send() sends a message to a peer", () => {
        const server = new SocketChannelServer({
            wss
        });

        const testMessage = {
            foo: 'bar',
            cat: 'dog',
        };

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1UUID = [...server.clients][0];
        client1.open();

        server.send(client1UUID, testMessage);

        expect(client1.lastMessage!.message)
            .toEqual(testMessage);
    });

    it("emits messages sent by clients", async () => {
        const server = new SocketChannelServer({
            wss
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.clients][0];
        client1.open();

        const testMessage = {
            foo: 'bar',
            cat: 'dog',
        };

        const serverEmitsPromise = server.message
            .pipe(take(1))
            .toPromise();

        client1.sendMessage({ message: testMessage });

        const serverEmits = await serverEmitsPromise;

        expect(serverEmits.message).toEqual(testMessage);
        expect(serverEmits.source).toEqual(client1Uuid);
    });

    it("pings a client if it hasn't received a message in a while", async () => {
        jasmine.clock().install();

        const server = new SocketChannelServer({
            wss,
            timeout: 10, // 10 ms
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);

        client1.open();

        jasmine.clock().tick(11);
        expect(client1.lastMessage!.ping).toBe(true);

        jasmine.clock().tick(11)

        jasmine.clock().uninstall();
    });

    it("does not disconnect a client if it replies", async () => {
        jasmine.clock().install();

        const server = new SocketChannelServer({
            wss,
            timeout: 10, // 10 ms
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.clients][0];
        client1.open();

        jasmine.clock().tick(11);
        expect(client1.lastMessage?.ping).toBe(true);

        client1.sendMessage({ pong: true });

        jasmine.clock().tick(11);

        expect([...server.clients]).toEqual([client1Uuid]);

        jasmine.clock().uninstall();
    });

    it("disconnects a client if it doesn't reply in time", async () => {
        jasmine.clock().install();

        const server = new SocketChannelServer({
            wss,
            timeout: 10, // 10 ms
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        const client1Uuid = [...server.clients][0];
        client1.open();

        const peerDisconnectPromise = server.clientDisconnect
            .pipe(take(1)).toPromise();

        jasmine.clock().tick(25);

        const peerDisconnect = await peerDisconnectPromise;
        expect(peerDisconnect).toEqual(client1Uuid);
        jasmine.clock().uninstall();
    });

    it("replies to pings", async () => {
        const server = new SocketChannelServer({
            wss,
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket);
        client1.open();

        client1.sendMessage({ ping: true });

        expect(client1.lastMessage!.pong).toBe(true);
    });
});

class ClientHarness {
    readonly websocket: jasmine.SpyObj<WebSocket>;
    readonly callbacks: Callbacks;
    readonly messagesFromServer = new Subject<SocketMessage>();
    lastMessage?: SocketMessage;

    constructor(private server: SocketChannelServer) {
        this.websocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy", ["on", "send", "removeAllListeners"]);
        const [callbacks, on] = trackOn();
        this.websocket.on.and.callFake(on);
        this.websocket.readyState = WebSocket.CONNECTING;
        this.callbacks = callbacks;
        this.websocket.send.and.callFake((data: any) => {
            const socketMessage =
                SocketMessage.decode(JSON.parse(data) as unknown);
            if (isLeft(socketMessage)) {
                throw new Error(`Failed to parse SocketMessage: ${data}`);
            }

            this.messagesFromServer.next(socketMessage.right);
            this.lastMessage = socketMessage.right;
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
    sendMessage(message: SocketMessage) {
        this.callbacks["message"][0](JSON.stringify(SocketMessage.encode(message)));
    }
}
