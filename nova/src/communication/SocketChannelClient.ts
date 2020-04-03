import { Subject } from "rxjs";
import { Channel, MessageWithSourceType } from "./Channel";
import { ManagementData, SocketMessageFromServer, SocketMessageToServer, StringSetDelta, GameMessage } from "novajs/nova/src/proto/nova_service_pb";

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

    private webSocket: WebSocket;
    warn: (m: string) => void;

    constructor({ webSocket, warn }: { webSocket?: WebSocket, warn?: ((m: string) => void) }) {
        if (webSocket) {
            this.webSocket = webSocket;
        }
        else {
            this.webSocket = new WebSocket(`ws://${location.host}`);
        }

        if (warn !== undefined) {
            this.warn = warn;
        }
        else {
            this.warn = console.warn;
        }

        this.webSocket.addEventListener("message", this.handleMessage.bind(this));
    }

    send(destination: string, data: GameMessage): void {
        const socketMessage = new SocketMessageToServer();
        socketMessage.setData(data);
        socketMessage.setDestination(destination);
        this.webSocket.send(socketMessage.serializeBinary());
    }

    broadcast(message: GameMessage): void {
        const socketMessage = new SocketMessageToServer();
        socketMessage.setData(message);
        socketMessage.setBroadcast(true);
        this.webSocket.send(socketMessage.serializeBinary());
    }

    private async handleMessage(messageEvent: MessageEvent) {
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

        const source = socketMessage.getSource();
        const managementData = socketMessage.getManagementdata();
        const message = socketMessage.getData();

        if (!source) {
            this.warn("Received a message with no source");
            return;
        }

        if (managementData) {
            // Management data is known to come from the server
            // It's impossible for another client to send management data.
            this.handleManagementData(socketMessage.getManagementdata()!);
        }

        if (message) {
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
        this.webSocket.close();
    }
}
