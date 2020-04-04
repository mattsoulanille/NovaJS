import { ManagementData, RepeatedString, SocketMessageFromServer, SocketMessageToServer, StringSetDelta, GameMessage, StringValue } from "novajs/nova/src/proto/nova_service_pb";
import { Subject } from "rxjs";
import UUID from "uuid/v4";
import WebSocket from "ws";
import { Channel, MessageWithSourceType } from "./Channel";
import http from "http";
import https from "https";
import { Socket } from "net";

interface Client {
    socket: WebSocket;
    keepaliveTimeout?: NodeJS.Timeout;
}

export class SocketChannelServer implements Channel {
    readonly onMessage = new Subject<MessageWithSourceType>();
    readonly onPeerConnect = new Subject<string>();
    readonly onPeerDisconnect = new Subject<string>();

    private clients = new Map<string, Client>();
    readonly wss: WebSocket.Server;
    readonly uuid: string;
    private warn: (m: string) => void = console.warn;

    readonly admins: Set<string>;
    // Send a ping if a packet hasn't been received in this long
    // If the ping doesn't get back in this much time, disconnect them.
    readonly timeout: number;

    constructor({ httpsServer, warn, uuid, admins, wss, timeout }: { httpsServer?: https.Server, warn?: ((m: string) => void), uuid?: string, admins?: Set<string>, wss?: WebSocket.Server, timeout?: number }) {

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

    get peers() {
        return new Set(this.clients.keys());
    }

    private sendRawIfOpen(destination: string,
        socketMessage: SocketMessageFromServer): boolean {

        const client = this.clients.get(destination);
        if (!client) {
            this.warn(`No such peer ${destination}`);
        } else if (client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(socketMessage.serializeBinary());
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
        for (const id of this.clients.keys()) {
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
        for (const id of this.clients.keys()) {
            this.sendRawIfOpen(id, message)
        }
    }

    broadcast(message: GameMessage) {
        this.rebroadast(this.uuid, message)
    }

    private resetClientTimeout(uuid: string) {
        const client = this.clients.get(uuid);
        if (!client) {
            throw new Error(`Tried to reset keepalive timeout`
                + ` of nonexistant client ${uuid}`);
        }

        if (client.keepaliveTimeout) {
            clearTimeout(client.keepaliveTimeout);
        }

        client.keepaliveTimeout = setTimeout(() => {
            // Send the client a ping
            const message = new SocketMessageFromServer();
            message.setPing(true);
            this.sendRawIfOpen(uuid, message);
            client.keepaliveTimeout = setTimeout(() => {
                // Remove the client if it hasn't responded
                this.handleClientClose(uuid);
            }, this.timeout);
        }, this.timeout);
    }

    // Handles when a client first connects
    // It might be better to abstract all this out with an object for each client.
    private onConnect(webSocket: WebSocket) {
        const clientUUID = UUID();
        // This uuid is used only for communication and
        // has nothing to do with the game engine's uuids
        const client: Client = {
            socket: webSocket,
        };
        this.clients.set(clientUUID, client);
        this.resetClientTimeout(clientUUID);

        if (webSocket.readyState === WebSocket.CONNECTING) {
            webSocket.on("open", this.handleClientOpen.bind(this, clientUUID));
        } else if (webSocket.readyState === WebSocket.OPEN) {
            this.handleClientOpen(clientUUID);
        } else {
            const state = webSocket.readyState === WebSocket.CLOSING
                ? "CLOSING" : "CLOSED";
            throw new Error(`Expected socket to be in CONNECTING or CONNECTED state but it was ${state}`);
        }

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
        this.resetClientTimeout(clientUUID);
        const client = this.clients.get(clientUUID);
        if (!client) {
            throw new Error(`Missing client object for ${clientUUID}`);
        }


        const message = SocketMessageToServer.deserializeBinary(serialized);
        if (message.getPong()) {
            // We already reset the client timeout above
            return;
        }

        const data = message.getData();
        const destination = message.getDestination();

        if (!data) {
            this.warn(`Message from ${clientUUID} had no data`);
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
            this.warn(`Message from ${clientUUID} had no destination and was not for broadcasting`);
        }
    }

    // Handles when a client disconnects
    private handleClientClose(clientUUID: string) {
        const client = this.clients.get(clientUUID);
        if (!client) {
            throw new Error(
                `Tried to remove nonexistant client ${clientUUID}`);
        }
        if (client.keepaliveTimeout !== undefined) {
            clearTimeout(client.keepaliveTimeout);
        }

        client.socket.removeAllListeners();
        this.clients.delete(clientUUID);
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
