import * as t from 'io-ts';

/**
 * The socket envelope: what one WebSocket frame holds. A message, or a
 * keepalive ping/pong. `socketMessageType` threads the payload's codec
 * through so the whole wire shape can be typed for the schema
 * derivation (wire_schemas.ts); the socket layer itself gates frames
 * with the untyped `SocketMessage` and hands the payload up.
 */
export function socketMessageType<A, O>(payload: t.Type<A, O, unknown>) {
    return t.partial({
        message: payload,
        ping: t.boolean,
        pong: t.boolean,
    });
}

export const SocketMessage = socketMessageType(t.unknown);

export type SocketMessage = t.TypeOf<typeof SocketMessage>;
