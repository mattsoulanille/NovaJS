import { ManagementData, SocketMessageFromServer, SocketMessageToServer, StringSetDelta, GameMessage } from "novajs/nova/src/proto/nova_service_pb";
import { Subject } from "rxjs";
import { Channel, MessageWithSourceType } from "./Channel";


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

    constructor({ webSocket, warn }: { webSocket: WebSocket, warn?: ((m: string) => void) }) {

        this.webSocket = webSocket;

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

    private handleMessage(messageEvent: MessageEvent) {
        const data = messageEvent.data;
        if (!(data instanceof Uint8Array)) {
            throw new Error(
                `Expected data to be a Uint8Array ` +
                `but it was ${typeof data}.`);
        }

        const socketMessage = SocketMessageFromServer.deserializeBinary(data);
        const source = socketMessage.getSource();
        const managementData = socketMessage.getManagementdata();
        const message = socketMessage.getData();

        if (!source) {
            this.warn("Received a message with no source");
            return;
        }

        if (managementData) {
            if (this.admins.has(source)) {
                this.handleManagementData(socketMessage.getManagementdata()!);
            }
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
            const delta = managementData.getAdminsdelta()!;
            this.applyStringSetDelta(delta, this.admins);
        }

        // Update peers set
        if (managementData.hasPeers()) {
            this.wrappedPeers = new Set(
                managementData.getPeers()!.getValueList());
        } else if (managementData.hasPeersdelta()) {
            const delta = managementData.getPeersdelta()!;
            this.applyStringSetDelta(delta, this.peers);
        }
    }

    private applyStringSetDelta(delta: StringSetDelta, stringSet: Set<string>) {
        for (const toAdd of delta.getAddList()) {
            stringSet.add(toAdd);
        }
        for (const toRemove of delta.getRemoveList()) {
            stringSet.delete(toRemove);
        }
    }

    disconnect() {
        this.webSocket.close();
    }
}
