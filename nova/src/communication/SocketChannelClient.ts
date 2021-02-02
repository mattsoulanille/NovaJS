import { isRight } from "fp-ts/lib/Either";
import { Subject } from "rxjs";
import { ChannelClient } from "./Channel";
import { SocketMessage } from "./SocketMessage";

export class SocketChannelClient implements ChannelClient {
    readonly message = new Subject<unknown>();

    webSocket: WebSocket;
    warn: (m: string) => void;
    readonly timeout: number;
    private keepaliveTimeout?: NodeJS.Timeout;
    private messageListener: (m: MessageEvent) => void;

    constructor({ webSocket, warn, timeout }: { webSocket?: WebSocket, warn?: ((m: string) => void), timeout?: number }) {
        if (webSocket) {
            // For testing
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

    send(message: unknown): void {
        this.sendRaw({ message });
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

            this.sendRaw({ ping: true });
            this.keepaliveTimeout = setTimeout(() => {
                this.warn("Lost connection. Reconnecting...");
                this.reconnect();
            }, this.timeout);
        }, this.timeout);
    }

    private sendRaw(message: SocketMessage) {
        this.reconnectIfClosed();
        if (this.webSocket.readyState === this.webSocket.OPEN) {
            this.webSocket.send(JSON.stringify(SocketMessage.encode(message)));
        }
    }

    private async handleMessage(messageEvent: MessageEvent) {
        this.resetTimeout();

        const data = messageEvent.data;
        let socketMessage: SocketMessage;
        const maybeSocketMessage = SocketMessage.decode(JSON.parse(data) as unknown);
        if (isRight(maybeSocketMessage)) {
            socketMessage = maybeSocketMessage.right;
        } else {
            this.warn(`Failed to deserialize message from server. `
                + `Errors: ${maybeSocketMessage.left}`);
            return;
        }

        if (socketMessage.pong) {
            // We already reset the timeout above.
            // No need to do anything if it's a pong.
            return;
        }

        if (socketMessage.ping) {
            // Reply with pong
            this.sendRaw({ pong: true });
            return;
        }

        const message = socketMessage.message;
        if (message) {
            this.message.next(message);
            return;
        }

        this.warn('Message had no body and was not a ping.');
    }

    disconnect() {
        this.webSocket.removeEventListener(
            "message", this.messageListener);
        this.webSocket.close();
    }
}
