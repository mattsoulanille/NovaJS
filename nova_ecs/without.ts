import { left, right } from "fp-ts/Either";
import { ArgTypes } from "./arg_types";
import { ArgModifier } from "./arg_modifier";
import { Optional } from "./optional";
import { Query } from "./query";


export function Without<V extends ArgTypes>(value: V) {
    return new ArgModifier({
        query: new Query([Optional(value)]),
        transform: (val) => {
            if (val !== undefined) {
                // Fail since the value was found
                return left(undefined);
            }
            // Succeed since the value was unavailable
            return right(undefined);
        }
    });
}
