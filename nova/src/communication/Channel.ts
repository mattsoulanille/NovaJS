import { Subject } from "rxjs";
import { GameMessage } from "novajs/nova/src/proto/nova_service_pb";

export interface MessageWithSourceType {
    message: GameMessage;
    source: string;
}

/**
 * This is a basic communication channel. It isn't supposed
 * to be fancy. Other fancier abstractions use it to make
 * interfaces with, for example, multiple different rooms.
 */
export interface ChannelServer {
    send(destination: string, message: GameMessage): void;

    readonly message: Subject<MessageWithSourceType>;
    readonly clientConnect: Subject<string>;
    readonly clientDisconnect: Subject<string>;
    readonly clients: Set<string>;
}

export interface ChannelClient {
    send(message: GameMessage): void,
    disconnect(): void

    readonly message: Subject<GameMessage>;
}


