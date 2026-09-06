import { isLeft, right } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';

/**
 * A Set codec, encoded as an array of encoded members.
 *
 * A subclass rather than a bare `new t.Type` so schema reflection
 * (nova's io_ts_to_avro) can see the member codec: a plain `t.Type`
 * closes over `value` and exposes nothing but its name. The `_tag` is
 * outside io-ts's own set, so io-ts's tag switches (`getProps`,
 * union indexing) fall through to their defaults exactly as they do
 * for any custom codec.
 */
export class SetType<Value, ValueEncode>
    extends t.Type<Set<Value>, ValueEncode[], unknown> {
    readonly _tag = 'NovaSetType' as const;
    constructor(readonly type: t.Type<Value, ValueEncode>) {
        super(
            `Set<${type.name}>`,
            // `every`, not an initial-value-less `reduce`: reduce throws on
            // an empty array, so an empty Set failed the guard (#84).
            (u): u is Set<Value> => u instanceof Set
                && [...u].every(u => type.is(u)),
            (i, context) => {
                const decoded = t.array(type).validate(i, context);
                if (isLeft(decoded)) {
                    return decoded;
                }
                return right(new Set(decoded.right));
            },
            (a) => [...a].map(v => type.encode(v)),
        );
    }
}

export function set<Value, ValueEncode>(value: t.Type<Value, ValueEncode>) {
    return new SetType(value);
}
