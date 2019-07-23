import { Channel, MessageType, MessageWithSourceType } from "../common/Channel";
import { AnyEvent } from "ts-events";
import { InitialDataType } from "../server/SocketChannelServer";



class SocketChannelClient implements Channel {
    public readonly onMessage: AnyEvent<MessageWithSourceType>;
    public readonly onConnect: AnyEvent<string>;
    public readonly onDisconnect: AnyEvent<string>;
    private _peers: Set<string>;
    private socket: SocketIOClient.Socket;
    warn: (m: string) => void;
    private _uuid: string | undefined;
    readonly readyPromise: Promise<void>;

    constructor({ socket, warn }: { socket: SocketIOClient.Socket, warn?: ((m: string) => void) }) {

        this.onMessage = new AnyEvent<MessageWithSourceType>();
        this.onConnect = new AnyEvent<string>();
        this.onDisconnect = new AnyEvent<string>();
        this._peers = new Set<string>();

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
        if (decodedMessage.isRight()) {
            this.onMessage.post(decodedMessage.value);
        }
        else {
            this.warn("Expected message to decode as " + MessageWithSourceType.name + " but "
                + "decoding failed with error:\n" + decodedMessage.value);
        }
    }

    private _handleSetInitialData(data: unknown) {
        let decoded = InitialDataType.decode(data);
        if (decoded.isRight()) {
            this._uuid = decoded.value.uuid;
            this._peers = new Set(decoded.value.peers);
        }
        else {
            this.warn(decoded.value.toString());
        }
    }

    private _handleAddPeer(peer: unknown) {
        if (typeof peer === "string") {
            this._peers.add(peer);
        }
    }

    private _handleRemovePeer(peer: unknown) {
        if (typeof peer === "string") {
            this._peers.delete(peer);
        }
    }

    get peers() {
        return this._peers;
    }
    get uuid() {
        return this._uuid;
    }
    disconnect() {
        this.socket.disconnect();
    }
}

export { SocketChannelClient }
