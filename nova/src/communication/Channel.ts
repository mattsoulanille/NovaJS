import { Subject } from "rxjs";

export interface MessageWithSourceType<M> {
    message: M;
    source: string;
}

/** 
 * This is a basic communication channel. It isn't supposed
 * to be fancy. Other fancier abstractions use it to make
 * interfaces with, for example, multiple different rooms.
 */
export interface ChannelServer {
    send(destination: string, message: unknown): void;

    readonly message: Subject<MessageWithSourceType<unknown>>;
    readonly clientConnect: Subject<string>;
    readonly clientDisconnect: Subject<string>;
    readonly clients: Set<string>;
}

export interface ChannelClient {
    send(message: unknown): void,
    disconnect(): void

    readonly message: Subject<unknown>;
}


