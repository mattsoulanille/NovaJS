import * as t from 'io-ts';
import { set } from 'nova_ecs/datatypes/set';


export enum MessageType {
    uuid,
    message,
    peers,
}

export const CommunicatorMessage = t.union([
    t.type({
        type: t.literal(MessageType.uuid),
        uuid: t.string,
    }),
    t.intersection([
        t.type({
            type: t.literal(MessageType.message),
            message: t.unknown,
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

export type CommunicatorMessage = t.TypeOf<typeof CommunicatorMessage>;

