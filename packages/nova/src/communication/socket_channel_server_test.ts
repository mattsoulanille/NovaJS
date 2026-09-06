import { isLeft } from "fp-ts/lib/Either.js";
import * as https from "https";
import * as http from "http";
import "jasmine";
import { SocketChannelServer } from "./socket_channel_server.js";
import { SocketMessage } from "./socket_message.js";
import { firstValueFrom, Subject } from "rxjs";
import { take } from "rxjs/operators";
import { WebSocket, WebSocketServer } from "ws";
import { Callbacks, On, trackOn } from "./test_utils.js";

describe("SocketChannelServer", function () {

    let wss: jasmine.SpyObj<WebSocketServer>;
    let wssCallbacks: Callbacks;

    beforeEach(() => {
        wss = jasmine.createSpyObj<WebSocketServer>("WebSocket.Server Spy", ["on"]);
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
            wss, timeout: 10,
        });

        expect(wss.on).toHaveBeenCalled();
        expect(wss.on.calls.mostRecent().args[0]).toBe("connection");
    });

    it("binds listeners to a client's socket", () => {
        new SocketChannelServer({
            wss, timeout: 10,
        });

        const webSocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy",
            ["on", "removeAllListeners", "terminate"]);
        const [webSocketCallbacks, on] = trackOn();
        webSocket.on.and.callFake(on);
        (webSocket as any).readyState = WebSocket.CONNECTING;

        expect(wssCallbacks["connection"][0]).toBeDefined();
        wssCallbacks["connection"][0](webSocket as unknown as WebSocket);

        expect(webSocketCallbacks["open"].length).toBe(1);
        expect(webSocketCallbacks["message"].length).toBe(1);
        expect(webSocketCallbacks["close"].length).toBe(1);
        // ws emits `error` for protocol violations (invalid UTF-8 in a
        // text frame, a frame over maxPayload); an EventEmitter with no
        // error listener throws ERR_UNHANDLED_ERROR — process exit.
        expect(webSocketCallbacks["error"].length).toBe(1);
        expect(() => webSocketCallbacks["error"][0](
            new Error('WS_ERR_INVALID_UTF8'))).not.toThrow();
    });

    it("bounds the frame size it will buffer", () => {
        const httpsServer =
            jasmine.createSpyObj<https.Server>("http.Server Spy", ["on"]);
        const [, on] = trackOn();
        httpsServer.on.and.callFake(on);
        const server = new SocketChannelServer({ server: httpsServer });
        // ws's default is 100 MiB, fully buffered and JSON.parsed per
        // frame from any client that passed the version gate.
        expect(server.wss.options.maxPayload).toBe(16 * 1024 * 1024);
    });

    describe("hostile frames", () => {
        it("drops an invalid-JSON text frame and keeps serving", async () => {
            const warnings: string[] = [];
            const server = new SocketChannelServer({
                wss, timeout: 10, warn: m => warnings.push(m),
            });
            const client1 = new ClientHarness(server);
            wssCallbacks["connection"][0](client1.websocket as unknown as WebSocket);
            client1.open();

            expect(() => client1.sendRaw('{')).not.toThrow();
            expect(() => client1.sendRaw('')).not.toThrow();
            expect(() => client1.sendRaw('null')).not.toThrow();
            expect(() => client1.sendRaw('[1,2]')).not.toThrow();
            expect(warnings.some(w => /unparseable/.test(w))).toBeTrue();

            // Still a client, still served.
            expect(server.clients.size).toBe(1);
            const emitted = firstValueFrom(server.message.pipe(take(1)));
            client1.sendMessage({ message: { ok: true } });
            expect((await emitted).message).toEqual({ ok: true });
        });

        it("a refused socket has an error listener while its close frame is in flight",
            () => {
                const server = new SocketChannelServer({
                    wss, timeout: 10, buildVersion: 'v1', warn: () => { },
                });
                const webSocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy",
                    ["on", "close", "removeAllListeners", "terminate"]);
                const [callbacks, on] = trackOn();
                webSocket.on.and.callFake(on);
                (webSocket as any).readyState = WebSocket.OPEN;
                wssCallbacks["connection"][0](webSocket as unknown as WebSocket,
                    { url: '/?v=v2' } as never);
                expect(webSocket.close).toHaveBeenCalled();
                expect(server.clients.size).toBe(0);
                expect(callbacks["error"]?.length).toBe(1);
                expect(() => callbacks["error"][0](new Error('x'))).not.toThrow();
            });
    });

    it("creates an entry for a new client in the clients set", () => {
        const server = new SocketChannelServer({
            wss, timeout: 10,
        });
        const webSocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy",
            ["on", "removeAllListeners", "terminate"]);
        const [webSocketCallbacks, on] = trackOn();
        webSocket.on.and.callFake(on);
        (webSocket as any).readyState = WebSocket.CONNECTING;
        wssCallbacks["connection"][0](webSocket as unknown as WebSocket);

        const uuids = [...server.clients];
        expect(uuids.length).toBe(1);
    });

    it("emits when a client connects", async () => {
        const server = new SocketChannelServer({
            wss, timeout: 10,
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket as unknown as WebSocket);
        const client1Uuid = [...server.clients][0];

        const peerConnectPromise = firstValueFrom(server.clientConnect.pipe(take(1)));

        client1.open();

        const peerConnect = await peerConnectPromise;
        expect(peerConnect).toEqual(client1Uuid);
    });

    it("emits when a client disconnects", async () => {
        const server = new SocketChannelServer({
            wss, timeout: 10,
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket as unknown as WebSocket);
        const client1Uuid = [...server.clients][0];
        client1.open();

        const peerDisconnectPromise = firstValueFrom(server.clientDisconnect.pipe(take(1)));

        client1.close();

        const peerDisconnect = await peerDisconnectPromise;
        expect(peerDisconnect).toEqual(client1Uuid);
    });

    it("send() sends a message to a peer", () => {
        const server = new SocketChannelServer({
            wss, timeout: 10,
        });

        const testMessage = {
            foo: 'bar',
            cat: 'dog',
        };

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket as unknown as WebSocket);
        const client1UUID = [...server.clients][0];
        client1.open();

        server.send(client1UUID, testMessage);

        expect(client1.lastMessage!.message)
            .toEqual(testMessage);
    });

    it("emits messages sent by clients", async () => {
        const server = new SocketChannelServer({
            wss, timeout: 10,
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket as unknown as WebSocket);
        const client1Uuid = [...server.clients][0];
        client1.open();

        const testMessage = {
            foo: 'bar',
            cat: 'dog',
        };

        const serverEmitsPromise = firstValueFrom(server.message.pipe(take(1)));


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
        wssCallbacks["connection"][0](client1.websocket as unknown as WebSocket);

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
        wssCallbacks["connection"][0](client1.websocket as unknown as WebSocket);
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
        wssCallbacks["connection"][0](client1.websocket as unknown as WebSocket);
        const client1Uuid = [...server.clients][0];
        client1.open();

        const peerDisconnectPromise = firstValueFrom(server.clientDisconnect.pipe(take(1)));

        jasmine.clock().tick(25);

        const peerDisconnect = await peerDisconnectPromise;
        expect(peerDisconnect).toEqual(client1Uuid);
        // ...and closes the socket: forgetting the map entry alone left
        // the TCP connection open with no listeners at all (a leaked
        // descriptor per keepalive cycle, and a crash on a late error).
        expect(client1.websocket.terminate).toHaveBeenCalled();
        expect(server.clients.size).toBe(0);
        // A close event trailing the timeout removal is harmless.
        expect(() => client1.close()).not.toThrow();
        jasmine.clock().uninstall();
    });

    it("replies to pings", async () => {
        const server = new SocketChannelServer({
            wss, timeout: 10,
        });

        // Connect client 1
        const client1 = new ClientHarness(server);
        wssCallbacks["connection"][0](client1.websocket as unknown as WebSocket);
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
        this.websocket = jasmine.createSpyObj<WebSocket>("WebSocket Spy",
            ["on", "send", "removeAllListeners", "terminate"]);
        const [callbacks, on] = trackOn();
        this.websocket.on.and.callFake(on);
        (this.websocket as any).readyState = WebSocket.CONNECTING;
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
        (this.websocket as any).readyState = WebSocket.OPEN;
        this.callbacks["open"][0]();
    }
    close() {
        (this.websocket as any).readyState = WebSocket.CLOSING;
        this.callbacks["close"][0]();
        (this.websocket as any).readyState = WebSocket.CLOSED;
    }
    sendMessage(message: SocketMessage) {
        this.sendRaw(JSON.stringify(SocketMessage.encode(message)));
    }
    /** A text frame's bytes as the server's message listener sees them. */
    sendRaw(text: string) {
        this.callbacks["message"][0](text);
    }
}
