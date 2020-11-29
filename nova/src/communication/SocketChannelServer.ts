import { isLeft } from "fp-ts/lib/Either";
import https from "https";
import { Subject } from "rxjs";
import UUID from "uuid/v4";
import WebSocket from "ws";
import { ChannelServer, MessageWithSourceType } from "./Channel";
import { SocketMessage } from "./SocketMessage";

interface Client {
    socket: WebSocket;
    keepaliveTimeout?: NodeJS.Timeout;
}

export class SocketChannelServer implements ChannelServer {
    readonly message = new Subject<MessageWithSourceType<unknown>>();
    readonly clientConnect = new Subject<string>();
    readonly clientDisconnect = new Subject<string>();

    private clientMap = new Map<string, Client>();
    readonly wss: WebSocket.Server;
    private warn: (m: string) => void = console.warn;

    // Send a ping if a packet hasn't been received in this long
    // If the ping doesn't get back in this much time, disconnect them.
    readonly timeout: number;

    constructor({ httpsServer, warn, wss, timeout }: { httpsServer?: https.Server, warn?: ((m: string) => void), wss?: WebSocket.Server, timeout?: number }) {

        if (warn) {
            this.warn = warn;
        }

        if (wss) {
            this.wss = wss;
        }
        else if (httpsServer) {
            this.wss = new WebSocket.Server({ server: httpsServer });
        }
        else {
            throw new Error("httpsServer or wss must be defined");
        }

        if (timeout) {
            this.timeout = timeout;
        } else {
            this.timeout = 1000;
        }

        this.wss.on("connection", this.onConnect.bind(this));
    }

    get clients() {
        return new Set(this.clientMap.keys());
    }

    private sendRawIfOpen(destination: string,
        socketMessage: SocketMessage): boolean {

        const client = this.clientMap.get(destination);
        if (!client) {
            this.warn(`No such client ${destination}`);
        } else if (client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(JSON.stringify(SocketMessage.encode(socketMessage)));
            return true;
        }
        return false;
    }

    send(destination: string, message: unknown) {
        return this.sendRawIfOpen(destination, { message });
    }

    private resetClientTimeout(uuid: string) {
        const client = this.clientMap.get(uuid);
        if (!client) {
            throw new Error(`Tried to reset keepalive timeout`
                + ` of nonexistant client ${uuid}`);
        }

        if (client.keepaliveTimeout) {
            clearTimeout(client.keepaliveTimeout);
        }

        client.keepaliveTimeout = setTimeout(() => {
            // Send the client a ping
            this.sendRawIfOpen(uuid, { ping: true });
            client.keepaliveTimeout = setTimeout(() => {
                // Remove the client if it hasn't responded
                this.handleClientClose(uuid);
            }, this.timeout);
        }, this.timeout);
    }

    /** Handles when a client first connects */
    private onConnect(webSocket: WebSocket) {
        const clientUUID = UUID();
        // This uuid is used only for communication and
        // has nothing to do with the game engine's uuids
        const client: Client = {
            socket: webSocket,
        };
        this.clientMap.set(clientUUID, client);
        this.resetClientTimeout(clientUUID);

        if (webSocket.readyState === WebSocket.CONNECTING) {
            webSocket.on("open", () => {
                this.clientConnect.next(clientUUID);
            });
        } else if (webSocket.readyState === WebSocket.OPEN) {
            this.clientConnect.next(clientUUID);
        } else {
            const state = webSocket.readyState === WebSocket.CLOSING
                ? "CLOSING" : "CLOSED";
            throw new Error(`Expected socket to be in CONNECTING or CONNECTED state but it was ${state}`);
        }

        webSocket.on("message", this.handleMessageFromClient.bind(this, clientUUID));
        webSocket.on("close", this.handleClientClose.bind(this, clientUUID));
    }

    // Handles messages received from clients. Forwards messages to their destination.
    private handleMessageFromClient(clientUUID: string, serialized: string) {
        this.resetClientTimeout(clientUUID);
        const client = this.clientMap.get(clientUUID);
        if (!client) {
            throw new Error(`Missing client object for ${clientUUID}`);
        }

        const maybeSocketMessage = SocketMessage.decode(JSON.parse(serialized));

        if (isLeft(maybeSocketMessage)) {
            console.warn(`Received bad message from client ${clientUUID}: ${maybeSocketMessage.left}`);
            return;
        }

        const socketMessage = maybeSocketMessage.right;
        if (socketMessage.pong) {
            // We already reset the client timeout above.
            // No need to do anything if it's a pong.
            return;
        }

        if (socketMessage.ping) {
            this.sendRawIfOpen(clientUUID, { pong: true });
            return;
        }

        if (!socketMessage.message) {
            this.warn(`Message from ${clientUUID} had no data`);
            return;
        }

        this.message.next({
            message: socketMessage.message,
            source: clientUUID,
        });
    }

    private handleClientClose(clientUUID: string) {
        const client = this.clientMap.get(clientUUID);
        if (!client) {
            throw new Error(
                `Tried to remove nonexistant client ${clientUUID}`);
        }

        if (client.keepaliveTimeout !== undefined) {
            clearTimeout(client.keepaliveTimeout);
        }

        client.socket.removeAllListeners();
        this.clientMap.delete(clientUUID);
        this.clientDisconnect.next(clientUUID);
    }
}
