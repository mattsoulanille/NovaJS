import { isLeft, right } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';


export function set<Value, ValueEncode>(value: t.Type<Value, ValueEncode>) {
    return new t.Type(
        `Set<${value.name}>`,
        // `every`, not an initial-value-less `reduce`: reduce throws on
        // an empty array, so an empty Set failed the guard (#84).
        (u): u is Set<Value> => u instanceof Set
            && [...u].every(u => value.is(u)),
        (i, context) => {
            const decoded = t.array(value).validate(i, context);
            if (isLeft(decoded)) {
                return decoded;
            }
            return right(new Set(decoded.right));
        },
        (a) => [...a].map(v => value.encode(v)),
    )
}
