import { isLeft, right } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';

// Encodes a Map as an array of [key, value] tuples. Tracker issue: string-
// and number-keyed maps could encode as plain objects instead (a wire-
// format change, so it needs a PROTOCOL_VERSION bump).
export function map<Key, KeyEncode, Value, ValueEncode>(key: t.Type<Key, KeyEncode>,
    value: t.Type<Value, ValueEncode>) {
    return new t.Type(`Map<${key.name}, ${value.name}>`,
        // `every`, not an initial-value-less `reduce`: reduce throws on
        // an empty array, so an empty Map failed the guard (#84).
        (u): u is Map<Key, Value> => u instanceof Map
            && [...u.entries()].every(([k, v]) => key.is(k) && value.is(v)),
        (i, context) => {
            const decoded = t.array(t.tuple([key, value])).validate(i, context);
            if (isLeft(decoded)) {
                return decoded;
            }
            return right(new Map(decoded.right));
        },
        (a) => [...a].map(([k, v]) =>
            [key.encode(k), value.encode(v)] as [KeyEncode, ValueEncode])
    )
}
