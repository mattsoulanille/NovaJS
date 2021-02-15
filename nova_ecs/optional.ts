import { isRight, Right, right } from "fp-ts/lib/Either";
import { Modifier } from "./modifier";
import { Query } from "./query";

export function Optional<V>(value: V): Modifier<[], V | undefined> {
    return new Modifier({
        query: new Query([]),
        transform: (getArg) => {
            const result = getArg(value);
            if (isRight(result)) {
                return result as Right<V>;
            }
            return right(undefined);
        }
    })
}
