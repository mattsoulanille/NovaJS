import { Subject } from "rxjs";
import { GameMessage } from "novajs/nova/src/proto/nova_service_pb";

export interface MessageWithSourceType {
    message: GameMessage;
    source: string;
}

/**
 * This is a basic communication channel. It isn't supposed
 * to be fancy. Other fancier abstractions use it to make
 * interfaces with, for example, multiple different rooms
 * and some guarantee about what data is transferred.
 */
export interface Channel {
    send(destination: string, message: GameMessage): void,
    broadcast(message: GameMessage): void,
    disconnect(): void
    // Broadcast is necessary so that when communicating
    // via websockets, the client doesn't spam the server with
    // individual messages to each other client.

    // Message source should not be spoofable.
    readonly onMessage: Subject<MessageWithSourceType>;
    readonly onPeerConnect: Subject<string>;
    readonly onPeerDisconnect: Subject<string>;
    readonly peers: Set<string>;

    // UUIDs for admins including the server(s)
    // They can change the state however they want.
    // This has to be at the Channel level because there
    // is no way to establish trust at the Communicator level.
    readonly admins: Set<string>;
    readonly uuid: string;
}

