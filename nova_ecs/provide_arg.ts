import { right } from "fp-ts/Either";
import { ArgModifier } from "./arg_modifier";
import { ArgData, ArgsToData, ArgTypes, GetEntity } from "./arg_types";
import { Component, ComponentData } from "./component";
import { Optional } from "./optional";
import { Query } from "./query";

export function ProvideArg<Provided extends Component<any>, Args extends readonly ArgTypes[]>({ provided, factory, args }: {
    provided: Provided,
    factory: (...args: ArgsToData<Args>) => ComponentData<Provided>,
    args: Args
}) {
    return new ArgModifier({
        query: new Query([Optional(provided), GetEntity, ...args] as const,
            `Provide ${provided.name}`),
        transform: (providedVal, entity, ...factoryArgs) => {
            if (providedVal) {
                return right(providedVal as ArgData<Provided>);
            }
            const newVal = factory(...factoryArgs);
            entity.components.set(provided, newVal);
            return right(newVal);
        }
    });
}
