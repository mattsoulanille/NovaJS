import { ManagementData, RepeatedString, SocketMessageFromServer, SocketMessageToServer, StringSetDelta, GameMessage, StringValue } from "novajs/nova/src/proto/nova_service_pb";
import { Subject } from "rxjs";
import * as UUID from "uuid/v4";
import * as WebSocket from "ws";
import { Channel, MessageWithSourceType } from "./Channel";
import http from "http";
import { Socket } from "net";

export class SocketChannelServer implements Channel {
    readonly onMessage = new Subject<MessageWithSourceType>();
    readonly onPeerConnect = new Subject<string>();
    readonly onPeerDisconnect = new Subject<string>();

    private clientSockets = new Map<string, WebSocket>();
    readonly wss: WebSocket.Server;
    readonly uuid: string;
    private warn: (m: string) => void = console.warn;

    readonly admins: Set<string>;

    constructor({ httpServer, warn, uuid, admins, wss }: { httpServer?: http.Server, warn?: ((m: string) => void), uuid?: string, admins?: Set<string>, wss?: WebSocket.Server }) {

        if (warn) {
            this.warn = warn;
        }

        if (uuid) {
            this.uuid = uuid;
        }
        else {
            this.uuid = UUID();
        }

        if (admins) {
            this.admins = new Set([...admins, this.uuid]);
        }
        else {
            this.admins = new Set([this.uuid]);
        }

        if (wss) {
            this.wss = wss;
        }
        else if (httpServer) {
            this.wss = new WebSocket.Server({ noServer: true });
            httpServer.on(
                "upgrade",
                (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
                    this.wss.handleUpgrade(request, socket, head, (ws) => {
                        this.wss.emit("connection", ws, request);
                    })
                });
        }
        else {
            throw new Error("httpServer or wss must be defined");
        }

        this.wss.on("connection", this.onConnect.bind(this));
    }

    get peers() {
        return new Set(this.clientSockets.keys());
    }

    private sendRawIfOpen(destination: string,
        socketMessage: SocketMessageFromServer): boolean {

        const destinationSocket = this.clientSockets.get(destination);
        if (!destinationSocket) {
            this.warn(`No such peer ${destination}`);
        } else if (destinationSocket.readyState === WebSocket.OPEN) {
            debugger;
            destinationSocket.send(socketMessage.serializeBinary());
            return true;
        }
        return false;
    }

    private sendIfOpen(source: string, destination: string, message: GameMessage) {
        const socketMessage = new SocketMessageFromServer();
        socketMessage.setSource(source);
        socketMessage.setData(message);
        return this.sendRawIfOpen(destination, socketMessage);
    }

    send(destination: string, message: GameMessage) {
        this.sendIfOpen(this.uuid, destination, message);
    }

    private rebroadcastRaw(exclude: string,
        socketMessage: SocketMessageFromServer) {
        for (const id of this.clientSockets.keys()) {
            if (id !== exclude) {
                this.sendRawIfOpen(id, socketMessage);
            }
        }
    }

    private rebroadast(source: string, message: GameMessage) {
        const socketMessage = new SocketMessageFromServer();
        socketMessage.setSource(source);
        socketMessage.setBroadcast(true);
        socketMessage.setData(message);

        this.rebroadcastRaw(source, socketMessage);
    }

    private broadcastRaw(message: SocketMessageFromServer) {
        for (const id of this.clientSockets.keys()) {
            this.sendRawIfOpen(id, message)
        }
    }

    broadcast(message: GameMessage) {
        this.rebroadast(this.uuid, message)
    }

    // Handles when a client first connects
    // It might be better to abstract all this out with an object for each client.
    private onConnect(webSocket: WebSocket) {
        const clientUUID = UUID();
        // This uuid is used only for communication and
        // has nothing to do with the game engine's uuids
        this.clientSockets.set(clientUUID, webSocket);
        debugger;
        webSocket.on("open", this.handleClientOpen.bind(this, clientUUID));
        webSocket.on("message", this.handleMessageFromClient.bind(this, clientUUID));
        webSocket.on("close", this.handleClientClose.bind(this, clientUUID));
    }

    private handleClientOpen(clientUUID: string) {
        // The peer is added to this.peers implicitly
        // by the socket getting added to clientSockets
        // in onConnect. this.peers is a getter.

        // Create the set of peers for this peer
        const peersSet = new Set(this.peers);
        // It is not a peer of itself
        peersSet.delete(clientUUID);
        // It is a peer of this server
        peersSet.add(this.uuid);

        // Send the new client its UUID
        const managementData = new ManagementData();
        const uuidValue = new StringValue();
        uuidValue.setValue(clientUUID);
        managementData.setUuid(uuidValue);

        // Send the new client the current list of peers
        const peers = new RepeatedString();
        peers.setValueList([...peersSet]);
        managementData.setPeers(peers);

        // Ditto for admins
        const admins = new RepeatedString();
        admins.setValueList([...this.admins]);
        managementData.setAdmins(admins);

        // Actually send the message to the new client
        const messageToNewPeer = new SocketMessageFromServer();
        messageToNewPeer.setManagementdata(managementData);
        if (!this.sendRawIfOpen(clientUUID, messageToNewPeer)) {
            this.warn("Failed to send message to the new peer");
        }

        // Send an update to all other peers that a new peer connected
        const messageToOthers = new SocketMessageFromServer();
        const managementDataToOthers = new ManagementData();
        const peerDelta = new StringSetDelta();
        peerDelta.setAddList([clientUUID]);
        managementDataToOthers.setPeersdelta(peerDelta);
        messageToOthers.setManagementdata(managementDataToOthers);

        this.rebroadcastRaw(clientUUID, messageToOthers);
        this.onPeerConnect.next(clientUUID);
    }

    // Handles messages received from clients. Forwards messages to their destination.
    private handleMessageFromClient(clientUUID: string, serialized: Uint8Array) {
        const message = SocketMessageToServer.deserializeBinary(serialized);
        const data = message.getData();
        const destination = message.getDestination();
        console.log(message);
        if (!data) {
            console.warn(`Message from ${clientUUID} had no data`);
            return;
        }

        if (message.getBroadcast()) {
            // Rebroadcast the message
            this.rebroadast(clientUUID, data);
            this.onMessage.next({
                message: data,
                source: clientUUID,
            });
        } else if (destination === this.uuid) {
            this.onMessage.next({
                message: data,
                source: clientUUID,
            });
        } else if (destination) {
            this.sendIfOpen(clientUUID, destination, data);
        } else {
            console.warn(`Message from ${clientUUID} had no destination and was not for broadcasting`);
        }
    }

    // Handles when a client disconnects
    private handleClientClose(clientUUID: string) {
        this.clientSockets.delete(clientUUID);
        const managementData = new ManagementData();
        const peersDelta = new StringSetDelta();
        peersDelta.addRemove(clientUUID);
        managementData.setPeersdelta(peersDelta);
        const message = new SocketMessageFromServer();
        message.setBroadcast(true);
        message.setManagementdata(managementData);

        this.broadcastRaw(message);
        this.onPeerDisconnect.next(clientUUID);
    }

    disconnect() {
        this.warn("Called disconnect on the server");
    }
}
