import { left, right } from "fp-ts/lib/Either";
import { ArgTypes } from "./arg_types";
import { Modifier } from "./modifier";
import { Optional } from "./optional";
import { Query } from "./query";


export function Without<V extends ArgTypes>(value: V) {
    return new Modifier({
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
