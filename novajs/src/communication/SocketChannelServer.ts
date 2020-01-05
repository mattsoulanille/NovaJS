import * as t from "io-ts";
import { Subject } from "rxjs";
import UUID from "uuid/v4";
import { Channel, MessageType, MessageWithSourceType } from "./Channel";
import { isRight } from "fp-ts/lib/Either";



const IncomingMessageType = t.type({
    destination: t.string,
    message: MessageType
});

const InitialDataType = t.type({
    peers: t.array(t.string),
    uuid: t.string,
    admins: t.array(t.string),
});

type InitialDataType = t.TypeOf<typeof InitialDataType>;

class SocketChannelServer implements Channel {
    // Socket.io is used as a fallback from WebRTC
    public readonly onMessage: Subject<MessageWithSourceType>;
    public readonly onPeerConnect: Subject<string>;
    public readonly onPeerDisconnect: Subject<string>;

    private clientSockets: { [index: string]: SocketIO.Socket };
    readonly io: SocketIO.Server;
    readonly uuid: string;
    private warn: (m: string) => void;

    readonly admins: Set<string>;

    constructor({ io, warn, uuid, admins }: { io: SocketIO.Server, warn?: ((m: string) => void), uuid?: string, admins?: Set<string> }) {

        this.onMessage = new Subject<MessageWithSourceType>();
        this.onPeerConnect = new Subject<string>();
        this.onPeerDisconnect = new Subject<string>();

        if (warn !== undefined) {
            this.warn = warn;
        }
        else {
            this.warn = console.warn;
        }

        if (uuid !== undefined) {
            this.uuid = uuid;
        }
        else {
            this.uuid = UUID();
        }

        if (admins !== undefined) {
            this.admins = new Set([...admins, this.uuid]);
        }
        else {
            this.admins = new Set([this.uuid]);
        }

        this.clientSockets = {};

        this.io = io;
        this.io.on("connection", this._onConnect.bind(this));

    }

    get peers() {
        return new Set(Object.keys(this.clientSockets));
    }

    // Handles when a client first connects
    // It might be better to abstract all this out with an object for each client.
    private _onConnect(socket: SocketIO.Socket) {
        const clientUUID = UUID();
        // This uuid is used only for communication and
        // has nothing to do with the game engine's uuid
        this.clientSockets[clientUUID] = socket;

        socket.on("ready", this._handleClientReady.bind(this, clientUUID, socket));
        socket.on("message", this._handleMessageFromClient.bind(this, clientUUID));
        socket.on("broadcast", this._handleBroadcastFromClient.bind(this, clientUUID, socket));
        socket.on("disconnect", this._onDisconnect.bind(this, clientUUID));

    }

    private _handleClientReady(clientUUID: string, socket: SocketIO.Socket) {
        this.onPeerConnect.next(clientUUID);

        let peersSet = new Set(this.peers);
        peersSet.delete(clientUUID);
        peersSet.add(this.uuid);

        let initialData: InitialDataType = {
            peers: [...peersSet],
            uuid: clientUUID,
            admins: [...this.admins]
        };
        socket.emit("setInitialData", initialData);

        socket.broadcast.emit("addPeer", clientUUID);
    }

    // Handles messages received from clients. Forwards messages to their destination.
    private _handleMessageFromClient(clientUUID: string, message: unknown) {
        const decoded = IncomingMessageType.decode(message);
        if (isRight(decoded)) {
            const decodedMessage = decoded.right;

            // The message formatted for forwarding
            const toForward: MessageWithSourceType = {
                source: clientUUID,
                message: decodedMessage.message
            };

            if (decodedMessage.destination === this.uuid) {
                this.onMessage.next(toForward);
            }
            else {
                let destinationSocket = this.clientSockets[decodedMessage.destination];
                if (destinationSocket !== undefined) {
                    destinationSocket.emit("message", toForward);
                }
            }
        }
        else {
            this.warn(
                "Expected message to decode as " + IncomingMessageType.name + " but "
                + "decoding failed with error:\n" + decoded.left);
        }
    }

    // Handles broadcast requests from the client.
    private _handleBroadcastFromClient(clientUUID: string, socket: SocketIO.Socket, message: unknown) {
        const decoded = MessageType.decode(message);
        if (isRight(decoded)) {
            const toBroadcast: MessageWithSourceType = {
                message: decoded.right,
                source: clientUUID
            };
            socket.broadcast.emit("message", toBroadcast);
            this.onMessage.next(toBroadcast);
        }
        else {
            this.warn(
                "Expected message to decode as " + MessageType.name + " but "
                + "decoding failed with error:\n" + decoded.left);
        }
    }


    // Handles when a client disconnects
    private _onDisconnect(clientUUID: string) {
        delete this.clientSockets[clientUUID];
        this.io.emit("removePeer", clientUUID);
        this.onPeerDisconnect.next(clientUUID);
    }

    private _constructMessage(message: unknown): MessageWithSourceType {
        return {
            message: message,
            source: this.uuid
        }
    }

    send(uuid: string, message: MessageType) {
        const socket = this.clientSockets[uuid];
        if (socket !== undefined) {
            socket.emit("message", this._constructMessage(message));
        }
        else {
            this.warn("Tried to send message to non-existent peer " + uuid);
        }
    }

    broadcast(message: MessageType) {
        this.io.emit("message", this._constructMessage(message));
    }
    disconnect() {
        this.warn("Called disconnect on the server");
    }
}

export { SocketChannelServer, InitialDataType };
