import { ManagementData, RepeatedString, StringValue, SocketMessageFromServer, StringSetDelta, SocketMessageToServer, GameMessage } from "novajs/nova/src/proto/nova_service_pb";

export type Callbacks = { [event: string]: ((...args: unknown[]) => unknown)[] };
export type On = (event: string, cb: (...args: any[]) => unknown) => any;
export function trackOn(): [Callbacks, On] {
    let callbacks: Callbacks = {}

    function on(event: string, cb: (...args: unknown[]) => unknown) {

        if (!callbacks[event]) {
            callbacks[event] = [];
        }
        callbacks[event].push(cb);
    }
    return [callbacks, on]
}


export class MessageBuilder {
    private wrappedManagement?: ManagementData;
    private get management(): ManagementData {
        if (!this.wrappedManagement) {
            this.wrappedManagement = new ManagementData();
        }
        return this.wrappedManagement;
    }

    private wrappedData?: GameMessage;
    private get data(): GameMessage {
        if (!this.wrappedData) {
            this.wrappedData = new GameMessage();
        }
        return this.wrappedData;
    }
    private set data(data: GameMessage) {
        this.wrappedData = data;
    }

    private broadcast?: boolean = undefined;
    private destination?: string;


    setBroadcast(broadcast: boolean) {
        this.broadcast = broadcast;
        return this;
    }

    addPeers(peersList: string[]) {
        const delta = new StringSetDelta();
        delta.setAddList(peersList);
        this.management.setPeersdelta(delta);
        return this;
    }

    removePeers(peersList: string[]) {
        const delta = new StringSetDelta();
        delta.setRemoveList(peersList);
        this.management.setPeersdelta(delta);
        return this;
    }

    setPeers(peersList: string[]) {
        const peers = new RepeatedString();
        peers.setValueList(peersList);
        this.management.setPeers(peers);
        return this;
    }

    setAdmins(adminsList: string[]) {
        const admins = new RepeatedString();
        admins.setValueList(adminsList);
        this.management.setAdmins(admins);
        return this;
    }

    setUuid(uuidString: string) {
        const uuid = new StringValue();
        uuid.setValue(uuidString);
        this.management.setUuid(uuid);
        return this;
    }

    setData(data: GameMessage) {
        this.data = data;
        return this;
    }

    setDestination(destination: string) {
        this.destination = destination;
        return this;
    }

    buildFromServer() {
        const message = new SocketMessageFromServer();
        if (this.wrappedManagement) {
            message.setManagementdata(this.wrappedManagement);
        }

        if (this.wrappedData) {
            message.setData(this.wrappedData);
        }

        if (this.broadcast !== undefined) {
            message.setBroadcast(this.broadcast);
        }
        return message;
    }

    buildToServer() {
        const message = new SocketMessageToServer();
        if (this.wrappedData) {
            message.setData(this.wrappedData);
        }

        if (this.broadcast !== undefined) {
            message.setBroadcast(this.broadcast);
        }

        if (this.destination) {
            message.setDestination(this.destination);
        }

        return message;
    }
}
