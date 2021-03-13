import { isLeft, left, right } from 'fp-ts/lib/Either';
import * as t from 'io-ts';

// TODO(mattsoulanille): Maybe optimize string and number keys by serializing
// them as objects instead of tuples?
export function map<Key, Value>(key: t.Type<Key>, value: t.Type<Value>) {
    return new t.Type(`Map<${key.name}, ${value.name}>`,
        (u): u is Map<Key, Value> => u instanceof Map
            && [...u.entries()]
                .map(([k, v]) => key.is(k) && value.is(v))
                .reduce((a, b) => a && b),
        (i, context) => {
            if (!(i instanceof Array)) {
                const error: t.ValidationError = {
                    context,
                    value: i,
                    message: `Expected ${i} to be an array`,
                }
                return left([error]);
            }

            const decoded = t.array(t.tuple([key, value])).validate(i, context);
            if (isLeft(decoded)) {
                return decoded;
            }
            return right(new Map(decoded.right));
        },
        (a) => [...a]
    )
}
