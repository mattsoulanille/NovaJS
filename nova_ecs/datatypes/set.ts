import { isLeft, right } from 'fp-ts/lib/Either';
import * as t from 'io-ts';


export function set<Value, ValueEncode>(value: t.Type<Value, ValueEncode>) {
    return new t.Type(
        `Set<${value.name}>`,
        (u): u is Set<Value> => u instanceof Set
            && [...u].map(u => value.is(u)).reduce((a, b) => a && b),
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
