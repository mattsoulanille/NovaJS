import { GameMessage, SocketMessage } from "novajs/nova/src/proto/nova_service_pb";
import { Subject } from "rxjs";
import { ChannelClient } from "./Channel";

export class SocketChannelClient implements ChannelClient {
    readonly message = new Subject<GameMessage>();

    webSocket: WebSocket;
    warn: (m: string) => void;
    readonly timeout: number;
    private keepaliveTimeout?: NodeJS.Timeout;
    private messageListener: (m: MessageEvent) => void;

    constructor({ webSocket, warn, timeout }: { webSocket?: WebSocket, warn?: ((m: string) => void), timeout?: number }) {
        if (webSocket) {
            // Mostly for testing
            this.webSocket = webSocket;
        } else {
            this.webSocket = new WebSocket(`wss://${location.host}`);
        }

        if (warn !== undefined) {
            this.warn = warn;
        } else {
            this.warn = console.warn;
        }

        if (timeout !== undefined) {
            this.timeout = timeout;
        } else {
            this.timeout = 1200;
        }

        this.messageListener = this.handleMessage.bind(this)
        this.webSocket.addEventListener("message", this.messageListener);
        this.resetTimeout();
    }

    reconnect() {
        this.webSocket.removeEventListener("message", this.messageListener);
        if (this.webSocket.readyState === WebSocket.CONNECTING
            || this.webSocket.readyState === WebSocket.OPEN) {
            this.webSocket.close();
        }
        this.webSocket = new WebSocket(`wss://${location.host}`);
        this.webSocket.addEventListener("message", this.messageListener);
        this.resetTimeout();
    }

    reconnectIfClosed() {
        if (this.webSocket.readyState === WebSocket.CLOSED
            || this.webSocket.readyState === WebSocket.CLOSING) {
            this.reconnect();
        }
    }

    send(data: GameMessage): void {
        this.reconnectIfClosed();
        const socketMessage = new SocketMessage();
        socketMessage.setData(data);
        this.webSocket.send(socketMessage.serializeBinary());
    }

    resetTimeout() {
        if (this.keepaliveTimeout !== undefined) {
            clearTimeout(this.keepaliveTimeout);
        }

        this.keepaliveTimeout = setTimeout(() => {
            if (this.webSocket.readyState === WebSocket.CLOSED
                || this.webSocket.readyState === WebSocket.CLOSING) {
                this.warn("Lost connection. Reconnecting...");
                this.reconnect();
                return;
            }

            const message = new SocketMessage();
            message.setPing(true);
            this.webSocket.send(message.serializeBinary());
            this.keepaliveTimeout = setTimeout(() => {
                this.warn("Lost connection. Reconnecting...");
                this.reconnect();
            }, this.timeout);
        }, this.timeout);
    }

    private async handleMessage(messageEvent: MessageEvent) {
        this.resetTimeout();
        const dataBlob = messageEvent.data;
        if (!(dataBlob instanceof Blob)) {
            this.warn(
                `Expected data to be a Blob ` +
                `but it was ${typeof dataBlob}.`);
            return;
        }

        const dataArrayBuffer = await new Response(dataBlob).arrayBuffer();
        const data = new Uint8Array(dataArrayBuffer);

        let socketMessage: SocketMessage;
        try {
            socketMessage = SocketMessage.deserializeBinary(data);
        } catch (e) {
            this.warn(`Failed to deserialize message from server. Error: ${e}`);
            return;
        }

        if (socketMessage.getPing()) {
            // Reply with pong
            const messageToServer = new SocketMessage();
            messageToServer.setPong(true);
            this.webSocket.send(messageToServer.serializeBinary());
            return;
        }

        const message = socketMessage.getData();
        if (message) {
            this.message.next(message);
        }
    }

    disconnect() {
        this.webSocket.removeEventListener(
            "message", this.messageListener);
        this.webSocket.close();
    }
}
