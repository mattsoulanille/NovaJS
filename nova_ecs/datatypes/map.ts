import { isLeft, right } from 'fp-ts/Either';
import * as t from 'io-ts';

// TODO(mattsoulanille): Maybe optimize string and number keys by serializing
// them as objects instead of tuples?
export function map<Key, KeyEncode, Value, ValueEncode>(key: t.Type<Key, KeyEncode>,
    value: t.Type<Value, ValueEncode>,
    makeMap: (entries: Array<[Key, Value]>) => Map<Key, Value> = (entries) => new Map(entries)) {
    return new t.Type(`Map<${key.name}, ${value.name}>`,
        (u): u is Map<Key, Value> => u instanceof Map
            && [...u.entries()]
                .map(([k, v]) => key.is(k) && value.is(v))
                .reduce((a, b) => a && b),
        (i, context) => {
            const decoded = t.array(t.tuple([key, value])).validate(i, context);
            if (isLeft(decoded)) {
                return decoded;
            }
            return right(makeMap(decoded.right));
        },
        (a) => [...a].map(([k, v]) =>
            [key.encode(k), value.encode(v)] as [KeyEncode, ValueEncode])
    )
}
