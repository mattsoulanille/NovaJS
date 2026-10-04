import { BehaviorSubject, Subject } from "rxjs";

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
    /**
     * Closes `client`'s connection from the server end and forgets it,
     * emitting its `clientDisconnect` synchronously, exactly as its own
     * close would. A no-op for a client that is already gone. Used to
     * retire a connection a reconnect token superseded
     * (communicator_server.ts).
     */
    disconnect(client: string): void;

    readonly message: Subject<MessageWithSourceType<unknown>>;
    readonly clientConnect: Subject<string>;
    readonly clientDisconnect: Subject<string>;
    readonly clients: Set<string>;
    readonly connected: BehaviorSubject<boolean>;
}

export interface ChannelClient {
    send(message: unknown): void,
    disconnect(): void
    readonly connected: BehaviorSubject<boolean>;

    readonly message: Subject<unknown>;

    /**
     * Sets what a REPLACEMENT connection opens with: each time the
     * channel replaces a connection it had, it calls `preamble` and, when
     * that returns a message, sends it as the new connection's very first
     * frame, ahead of anything else. The reconnect token's slot (#354,
     * #366; communicator_client.ts): the server honours a token only as a
     * connection's first frame. A channel that never replaces its
     * connection may ignore it.
     */
    setReconnectPreamble(preamble: () => unknown): void;
}


