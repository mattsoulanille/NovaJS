import { GameMessage, ManagementData, SocketMessageFromServer, SocketMessageToServer } from "novajs/nova/src/proto/nova_service_pb";
import { Subject } from "rxjs";
import { Channel, MessageWithSourceType } from "./Channel";

interface Delta<T> {
    add: Set<T>;
    remove: Set<T>;
}

function setDiff<T>(a: Set<T>, b: Set<T>): Set<T> {
    return new Set([...a].filter((v) => !b.has(v)));
}

export class SocketChannelClient implements Channel {
    readonly onMessage = new Subject<MessageWithSourceType>();
    readonly onPeerConnect = new Subject<string>();
    readonly onPeerDisconnect = new Subject<string>();

    private wrappedAdmins = new Set<string>();
    get admins() {
        return this.wrappedAdmins;
    }

    private wrappedPeers = new Set<string>();
    get peers() {
        return this.wrappedPeers;
    }

    private wrappedUuid?: string;
    get uuid() {
        if (this.wrappedUuid === undefined) {
            throw new Error("UUID not yet available");
        }
        return this.wrappedUuid;
    }

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

    send(destination: string, data: GameMessage): void {
        this.reconnectIfClosed();
        const socketMessage = new SocketMessageToServer();
        socketMessage.setData(data);
        socketMessage.setDestination(destination);
        this.webSocket.send(socketMessage.serializeBinary());
    }

    broadcast(message: GameMessage): void {
        this.reconnectIfClosed();
        const socketMessage = new SocketMessageToServer();
        socketMessage.setData(message);
        socketMessage.setBroadcast(true);
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

            const message = new SocketMessageToServer();
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

        let socketMessage: SocketMessageFromServer;
        try {
            socketMessage = SocketMessageFromServer.deserializeBinary(data);
        } catch (e) {
            this.warn(`Failed to deserialize message from server. Error: ${e}`);
            return;
        }

        if (socketMessage.getPing()) {
            // Reply with pong
            const messageToServer = new SocketMessageToServer();
            messageToServer.setPong(true);
            this.webSocket.send(messageToServer.serializeBinary());
            return;
        }

        const managementData = socketMessage.getManagementdata();
        const message = socketMessage.getData();

        if (managementData) {
            // Management data is known to come from the server
            // It's impossible for another client to send management data.
            this.handleManagementData(socketMessage.getManagementdata()!);
        }

        if (message) {
            const source = socketMessage.getSource();
            if (!source) {
                this.warn(`Received a message with no `
                    + `source: ${message?.toObject()}`);
                return;
            }

            // It's a higher up layer's responsibility
            // to decide if the message is valid coming
            // from the source.
            this.onMessage.next({
                message,
                source
            });
        }
    }

    private handleManagementData(managementData: ManagementData) {
        // Set the UUID
        if (managementData.hasUuid()) {
            this.wrappedUuid = managementData.getUuid()!.getValue();
        }

        // Update admins set
        if (managementData.hasAdmins()) {
            this.wrappedAdmins = new Set(
                managementData.getAdmins()!.getValueList());
        } else if (managementData.hasAdminsdelta()) {
            const deltaProto = managementData.getAdminsdelta()!;
            const delta = {
                add: new Set(deltaProto.getAddList()),
                remove: new Set(deltaProto.getRemoveList()),
            };
            this.applyDelta(delta, this.admins);
        }

        // Update peers set
        if (managementData.hasPeers()) {
            const newPeers =
                new Set(managementData.getPeers()!.getValueList());
            const delta = this.getDelta(this.peers, newPeers);

            this.wrappedPeers = newPeers;
            this.reportPeersDelta(delta);
        } else if (managementData.hasPeersdelta()) {
            const deltaProto = managementData.getPeersdelta()!;
            const delta = {
                add: new Set(deltaProto.getAddList()),
                remove: new Set(deltaProto.getRemoveList()),
            };
            this.applyDelta(delta, this.peers);
            this.reportPeersDelta(delta);
        }
    }

    private reportPeersDelta(delta: Delta<string>) {
        for (const toAdd of delta.add) {
            this.onPeerConnect.next(toAdd);
        }
        for (const toRemove of delta.remove) {
            this.onPeerDisconnect.next(toRemove);
        }
    }

    private getDelta<T>(current: Set<T>, newSet: Set<T>): Delta<T> {
        return {
            add: setDiff(newSet, current),
            remove: setDiff(current, newSet),
        };
    }

    private applyDelta<T>(delta: Delta<T>, applyTo: Set<T>) {
        for (const toAdd of delta.add) {
            applyTo.add(toAdd);
        }
        for (const toRemove of delta.remove) {
            applyTo.delete(toRemove);
        }
    }

    disconnect() {
        this.webSocket.removeEventListener(
            "message", this.messageListener);
        this.webSocket.close();
    }
}
