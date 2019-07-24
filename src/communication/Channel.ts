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
    readonly onMessage: AnyEvent<MessageWithSourceType>;
    readonly onConnect: AnyEvent<string>;
    readonly onDisconnect: AnyEvent<string>;
    readonly peers: Set<string>;

}


export { Channel, MessageType, MessageWithSourceType } 
