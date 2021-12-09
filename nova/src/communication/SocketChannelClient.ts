import { isRight } from "fp-ts/lib/Either";
import { Subject } from "rxjs";
import { ChannelClient } from "./Channel";
import { SocketMessage } from "./SocketMessage";

export class SocketChannelClient implements ChannelClient {
    readonly message = new Subject<unknown>();

    webSocket: WebSocket;
    private webSocketFactory: () => WebSocket;
    warn: (m: string) => void;
    readonly timeout: number;
    private keepaliveTimeout?: NodeJS.Timeout;
    private messageListener: (m: MessageEvent) => void;
    private messageQueue: SocketMessage[] = [];

    constructor({ webSocket, warn, timeout, webSocketFactory }: { webSocket?: WebSocket, warn?: ((m: string) => void), timeout?: number, webSocketFactory?: () => WebSocket }) {
        this.webSocketFactory = webSocketFactory ?? (() => {
            if (location.protocol === "https:") {
                return new WebSocket(`wss://${location.host}`);
            }
            return new WebSocket(`ws://${location.host}`);
        });

        this.webSocket = webSocket ?? this.webSocketFactory();
        this.warn = warn ?? console.warn;
        this.timeout = timeout ?? 1200;

        this.messageListener = this.handleMessage.bind(this)
        this.webSocket.addEventListener("message", this.messageListener);
        this.resetTimeout();
    }

    reconnect() {
        this.webSocket.removeEventListener("message", this.messageListener);
        if (this.webSocket.readyState === this.webSocket.CONNECTING
            || this.webSocket.readyState === this.webSocket.OPEN) {
            this.webSocket.close();
        }
        this.webSocket = this.webSocketFactory();
        this.webSocket.addEventListener("message", this.messageListener);
        this.resetTimeout();
    }

    reconnectIfClosed() {
        if (this.webSocket.readyState === this.webSocket.CLOSED
            || this.webSocket.readyState === this.webSocket.CLOSING) {
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
            if (this.webSocket.readyState === this.webSocket.CLOSED
                || this.webSocket.readyState === this.webSocket.CLOSING) {
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
            for (const message of this.messageQueue) {
                this.webSocket.send(JSON.stringify(SocketMessage.encode(message)));
            }
            this.messageQueue.length = 0;
            this.webSocket.send(JSON.stringify(SocketMessage.encode(message)));
        } else {
            this.messageQueue.push(message);
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
