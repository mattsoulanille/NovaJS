import * as t from "io-ts";
import { AnyEvent } from "ts-events";

const MessageType = t.unknown;
type MessageType = t.TypeOf<typeof MessageType>;

const MessageWithSourceType = t.type({
    source: t.string,
    message: MessageType
});
type MessageWithSourceType = t.TypeOf<typeof MessageWithSourceType>;

interface Channel {
    send(destination: string, message: MessageType): void,
    broadcast(message: MessageType): void,
    disconnect(): void
    // Broadcast is necessary so that when communicating
    // via socket.io, the client doesn't spam the server with
    // individual messages to each other client.

    // Message source should not be spoofable.
    readonly onMessage: AnyEvent<MessageWithSourceType>;
    readonly onPeerConnect: AnyEvent<string>;
    readonly onPeerDisconnect: AnyEvent<string>;
    readonly peers: Set<string>;

    // UUIDs for admins including the server(s)
    // They can change the state however they want.
    // This has to be at the Channel level because there
    // is no way to establish trust at the Communicator level.
    readonly admins: Set<string>;
    readonly uuid: string;
}


export { Channel, MessageType, MessageWithSourceType } 
