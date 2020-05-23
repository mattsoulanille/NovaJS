import { Subject } from "rxjs";
import { GameMessage, IGameMessage } from "novajs/nova/src/proto/protobufjs_bundle";


export interface MessageWithSourceType {
    message: IGameMessage;
    source: string;
}

/** 
 * This is a basic communication channel. It isn't supposed
 * to be fancy. Other fancier abstractions use it to make
 * interfaces with, for example, multiple different rooms.
 */
export interface ChannelServer {
    send(destination: string, message: IGameMessage): void;

    readonly message: Subject<MessageWithSourceType>;
    readonly clientConnect: Subject<string>;
    readonly clientDisconnect: Subject<string>;
    readonly clients: Set<string>;
}

export interface ChannelClient {
    send(message: IGameMessage): void,
    disconnect(): void

    readonly message: Subject<GameMessage>;
}


