import { GameMessage, SocketMessage } from "novajs/nova/src/proto/protobufjs_bundle";
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
        socketMessage.data = data;

        this.webSocket.send(SocketMessage.encode(socketMessage).finish());
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
            message.ping = true;
            this.webSocket.send(SocketMessage.encode(message).finish());
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
            socketMessage = SocketMessage.decode(data);
        } catch (e) {
            this.warn(`Failed to deserialize message from server. Error: ${e}`);
            return;
        }

        if (socketMessage.ping) {
            // Reply with pong
            const messageToServer = new SocketMessage();
            messageToServer.pong = true;
            this.webSocket.send(SocketMessage.encode(messageToServer).finish());
            return;
        }

        const message = socketMessage.data;
        if (message) {
            this.message.next(new GameMessage(message));
        }
    }

    disconnect() {
        this.webSocket.removeEventListener(
            "message", this.messageListener);
        this.webSocket.close();
    }
}
