import { isRight, left } from "fp-ts/lib/Either";
import { GetArg, QueryArgs } from "./arg_types";
import { Component } from "./component";
import { Modifier } from "./modifier";
import { Query } from "./query";
import { Resource } from "./resource";


type ProviderFor<T> = Modifier<any, Component<T>>;

export function Aggregator<T>(component: Component<T>) {
    // TODO? Allow multiple aggregators for the same component?
    const SourcesResource = new Resource<ProviderFor<T>[]>(
        `${component.name} aggregator`);

    const query = new Query([GetArg, SourcesResource] as const);
    const modifier = new Modifier<QueryArgs<typeof query>, Component<T>>({
        query,
        transform: (getArg, sources) => {
            for (const source of sources) {
                const result = getArg(source);
                if (isRight(result)) {
                    return result;
                }
            }
            const result = getArg(component);
            if (isRight(result)) {
                return result;
            }

            return left(undefined);
        }
    });

    return [SourcesResource, modifier] as const;
}


// const AggregatorPlugin: Plugin = {
//     name: 'AggregatorPlugin',
//     build(world) {

//     }
// }
