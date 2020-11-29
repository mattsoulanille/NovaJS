import * as t from 'io-ts';

export const SocketMessage = t.partial({
    message: t.unknown,
    ping: t.boolean,
    pong: t.boolean,
});


export type SocketMessage = t.TypeOf<typeof SocketMessage>;

