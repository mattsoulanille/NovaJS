import * as t from 'io-ts';
import { set } from 'nova_ecs/datatypes/set';


export enum MessageType {
    uuid,
    message,
    peers,
    /** A reconnecting client's previous token (client -> server only). */
    reconnect,
}

/**
 * The communicator envelope inside a socket message: a peer's uuid
 * assignment, the peer set, or a routed message. `communicatorMessageType`
 * threads the routed payload's codec through (see socket_message.ts).
 *
 * The uuid assignment is the server's FIRST frame to a connecting
 * client, and it also announces `servers`, the server's own uuid set:
 * the client takes its `communicator.servers` from it (Trust model
 * item 4, rollback_protocol.ts) rather than assuming a constant. Only
 * the socket's server end can put a uuid frame on a client's socket —
 * CommunicatorServer drops any a client sends and re-wraps everything
 * it relays as a `message` — so the announcement's provenance is the
 * socket itself.
 *
 * The uuid frame also carries the connection's RECONNECT TOKEN (#354):
 * an unguessable bearer secret the server generated for THIS connection
 * alone (communicator_server.ts issueToken). The frame goes to that one
 * socket, so no other peer ever sees it. A client whose socket died
 * presents its previous connection's token as the FIRST communicator
 * frame of its next one — the `reconnect` kind, client -> server — and
 * the server retires that previous connection at once instead of waiting
 * for its keepalive to notice a half-open socket. It retires a
 * connection and nothing more: the new connection keeps its own new uuid
 * (identity stays per socket) and nothing the old one owned is handed
 * over. The server never answers a presentation, valid or not.
 */
export function communicatorMessageType<A, O>(payload: t.Type<A, O, unknown>) {
    return t.union([
        t.type({
            type: t.literal(MessageType.uuid),
            uuid: t.string,
            servers: set(t.string),
            token: t.string,
        }),
        t.intersection([
            t.type({
                type: t.literal(MessageType.message),
                message: payload,
            }),
            t.partial({
                source: t.string,
                destination: t.union([t.string, set(t.string)]),
            })
        ]),
        t.type({
            type: t.literal(MessageType.peers),
            peers: set(t.string),
        }),
        t.type({
            type: t.literal(MessageType.reconnect),
            token: t.string,
        }),
    ]);
}

export const CommunicatorMessage = communicatorMessageType(t.unknown);

export type CommunicatorMessage = t.TypeOf<typeof CommunicatorMessage>;
