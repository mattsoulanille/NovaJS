import * as t from 'io-ts';


export enum MessageType {
    uuid,
    message,
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
            destination: t.string,
        })
    ])
]);

export type CommunicatorMessage = t.TypeOf<typeof CommunicatorMessage>;

