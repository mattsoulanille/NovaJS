import { isLeft, left, right } from 'fp-ts/lib/Either';
import * as t from 'io-ts';


export function set<A, O>(Value: t.Type<A, O>) {
    type Value = t.TypeOf<typeof Value>;
    return new t.Type<Set<Value>, Value[]>(
        `Set(${Value.name})`,
        (u): u is Set<Value> => u instanceof Set
            && [...u].map(u => Value.is(u)).reduce((a, b) => a && b),
        (i, context) => {
            if (!(i instanceof Array)) {
                const error: t.ValidationError = {
                    context,
                    value: i,
                    message: `Expected ${i} to be an array`,
                }
                return left([error]);
            }

            const decoded = t.array(Value).validate(i, context);
            if (isLeft(decoded)) {
                return decoded;
            }
            return right(new Set(decoded.right));
        },
        (a) => {
            return [...a];
        }
    )
}
