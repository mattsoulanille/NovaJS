import { Channel, MessageType, MessageWithSourceType } from "./Channel";
import { AnyEvent } from "ts-events";
import { InitialDataType } from "./SocketChannelServer";
import { isRight } from "fp-ts/lib/Either";



class SocketChannelClient implements Channel {
    public readonly onMessage: AnyEvent<MessageWithSourceType>;
    public readonly onPeerConnect: AnyEvent<string>;
    public readonly onPeerDisconnect: AnyEvent<string>;
    private _peers: Set<string>;
    private socket: SocketIOClient.Socket;
    warn: (m: string) => void;
    private _uuid: string | undefined;
    private _admins: Set<string>;
    readonly readyPromise: Promise<void>;


    constructor({ socket, warn }: { socket: SocketIOClient.Socket, warn?: ((m: string) => void) }) {

        this.onMessage = new AnyEvent<MessageWithSourceType>();
        this.onPeerConnect = new AnyEvent<string>();
        this.onPeerDisconnect = new AnyEvent<string>();
        this._peers = new Set<string>();
        this._admins = new Set<string>();

        if (warn !== undefined) {
            this.warn = warn;
        }
        else {
            this.warn = console.warn;
        }

        this.socket = socket;
        this.socket.on("message", this._handleMessage.bind(this));
        this.socket.on("setInitialData", this._handleSetInitialData.bind(this));
        this.socket.on("addPeer", this._handleAddPeer.bind(this));
        this.socket.on("removePeer", this._handleRemovePeer.bind(this));
        this.socket.emit("ready");
        this.readyPromise = new Promise((fulfill) => {
            this.socket.once("setInitialData", () => fulfill());
        });
    }

    send(destination: string, message: MessageType): void {
        this.socket.emit("message", { destination, message });
    }

    broadcast(message: MessageType): void {
        this.socket.emit("broadcast", message);
    }

    private _handleMessage(message: unknown) {
        const decodedMessage = MessageWithSourceType.decode(message)
        if (isRight(decodedMessage)) {
            this.onMessage.post(decodedMessage.right);
        }
        else {
            this.warn("Expected message to decode as " + MessageWithSourceType.name + " but "
                + "decoding failed with error:\n" + decodedMessage.left);
        }
    }

    private _handleSetInitialData(data: unknown) {
        let decoded = InitialDataType.decode(data);
        if (isRight(decoded)) {
            this._uuid = decoded.right.uuid;
            this._peers = new Set(decoded.right.peers);
            this._admins = new Set(decoded.right.admins);
        }
        else {
            this.warn(decoded.left.toString());
        }
    }

    private _handleAddPeer(peer: unknown) {
        if (typeof peer === "string") {
            this._peers.add(peer);
            this.onPeerConnect.post(peer);
        }
        else {
            this.warn("Expected peer to be string but got " + peer);
        }
    }

    private _handleRemovePeer(peer: unknown) {
        if (typeof peer === "string") {
            this._peers.delete(peer);
            this.onPeerDisconnect.post(peer);
        }
    }

    get peers() {
        return this._peers;
    }
    get uuid() {
        if (this._uuid === undefined) {
            throw new Error("UUID not yet available");
        }
        return this._uuid;
    }
    get admins() {
        return this._admins;
    }
    disconnect() {
        this.socket.disconnect();
    }
}

export { SocketChannelClient }
