import * as t from 'io-ts';
import { set } from 'nova_ecs/datatypes/set';


export enum MessageType {
    uuid,
    message,
    peers,
}

/**
 * The communicator envelope inside a socket message: a peer's uuid
 * assignment, the peer set, or a routed message. `communicatorMessageType`
 * threads the routed payload's codec through (see socket_message.ts).
 */
export function communicatorMessageType<A, O>(payload: t.Type<A, O, unknown>) {
    return t.union([
        t.type({
            type: t.literal(MessageType.uuid),
            uuid: t.string,
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
    ]);
}

export const CommunicatorMessage = communicatorMessageType(t.unknown);

export type CommunicatorMessage = t.TypeOf<typeof CommunicatorMessage>;
