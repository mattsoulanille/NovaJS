import { left, right } from "fp-ts/lib/Either";
import { ArgTypes } from "./arg_types";
import { ArgModifier } from "./arg_modifier";
import { Optional } from "./optional";
import { Query } from "./query";


export function FirstAvailable<V extends ArgTypes>(values: V[]) {
    return new ArgModifier({
        query: new Query(values.map(v => Optional(v))),
        transform: (...vals) => {
            for (const val of vals) {
                if (val !== undefined) {
                    // Succeed with the first value found.
                    return right(val);
                }
            }
            // Fail since no value was available.
            return left(undefined);
        }
    });
}
