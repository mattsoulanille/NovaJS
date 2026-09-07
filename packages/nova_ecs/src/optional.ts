import { isRight, Right, right } from "fp-ts/lib/Either.js";
import { ArgModifier } from "./arg_modifier.js";
import { ArgData, ArgTypes, GetArg } from "./arg_types.js";
import { Query, referencedComponentsOfArg } from "./query.js";

export function Optional<V extends ArgTypes>(value: V):
    ArgModifier<readonly [typeof GetArg], V | undefined> {
    return new ArgModifier({
        query: new Query([GetArg] as const),
        // The transform resolves `value` through getArg and its result
        // is cached, so the wrapped arg's components are part of the
        // enclosing query's staleness set.
        extraComponents: referencedComponentsOfArg(value),
        reaches: [value],
        transform: (getArg) => {
            const result = getArg(value);
            if (isRight(result)) {
                return result as Right<ArgData<V>>;
            }
            return right(undefined);
        }
    })
}
