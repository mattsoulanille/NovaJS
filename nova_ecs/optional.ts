import { isRight, Right, right } from "fp-ts/lib/Either";
import { ArgData, ArgTypes, GetArg } from "./arg_types";
import { Modifier } from "./modifier";
import { Query } from "./query";

export function Optional<V extends ArgTypes>(value: V):
    Modifier<readonly [typeof GetArg], V | undefined> {
    return new Modifier({
        query: new Query([GetArg] as const),
        transform: (getArg) => {
            const result = getArg(value);
            if (isRight(result)) {
                return result as Right<ArgData<V>>;
            }
            return right(undefined);
        }
    })
}
