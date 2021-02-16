import { Either, left, Right, right } from "fp-ts/lib/Either";
import { immerable } from "immer";
import { ArgData, ArgsToData, ArgTypes, GetArg, GetEntity } from "./arg_types";
import { Component, ComponentData, UnknownComponent } from "./component";
import { Entity } from "./entity";
import { Modifier } from "./modifier";
import { Optional } from "./optional";
import { Query } from "./query";


type ProviderMapEntry = {
    promise: Promise<unknown>,
    complete: boolean,
    result?: unknown,
    error?: Error,
};

type ProviderComponentData = {
    [immerable]: false,
    map: Map<UnknownComponent, ProviderMapEntry>
};
export const ProviderComponent = new Component<
    ProviderComponentData>({ name: 'ProviderComponent' });

const ProviderComponentProvider = Provide({
    provided: ProviderComponent,
    args: [],
    factory: () => ({ [immerable]: false, map: new Map() } as const)
} as const);

export function Provide<Provided extends Component<any, any, any, any>, Args extends readonly ArgTypes[]>({ provided, factory, args }: {
    provided: Provided,
    factory: (...args: ArgsToData<Args>) => ComponentData<Provided>,
    args: Args
}) {
    return new Modifier({
        query: new Query([Optional(provided), GetEntity, ...args] as const),
        transform: (providedVal, entity, ...factoryArgs) => {

            if (providedVal) {
                return right(providedVal as Provided);
            }
            const newVal = factory(...factoryArgs);
            entity.components.set(provided, newVal);
            return right(newVal);
        }
    });
}

/*
// This needs to use AsyncSystem so the factory that's running can
// work asynchronously without trying to access revoked proxies.
export function Provideasync<Provided extends Component<any, any, any, any>, Args extends readonly ArgTypes[]>({ provided, factory, args }: {
    provided: Provided,
    factory: (...args: ArgsToData<Args>)
        => ComponentData<Provided> | Promise<ComponentData<Provided>>,
    args: Args
}) {
    type Data = ComponentData<Provided>;
    return new Modifier({
        query: new Query([GetArg, ProviderComponentProvider,
            Optional(provided), GetEntity, ...args] as const),
        transform: (getArg, providerComponent, providedVal, entity, ...factoryArgs) => {
            const providerMap = providerComponent.map;
            if (providedVal) {
                return right(providedVal);
            } else if (providerMap.has(provided as UnknownComponent)) {
                const providerMapEntry = providerMap
                    .get(provided as UnknownComponent)!;

                if (providerMapEntry.complete) {
                    if (providerMapEntry.error) {
                        providerMap.delete(provided as UnknownComponent);
                        throw providerMapEntry.error;
                    }
                    entity.components.set(provided, providerMapEntry.result as Data);
                    //return right(providerMapEntry.val);
                    return getArg(provided);
                }
                return left(undefined);
            } else {
                const newData = factory(...factoryArgs);
                if (newData instanceof Promise) {
                    const providerMapEntry: ProviderMapEntry = {
                        complete: false,
                        promise: newData.then(result => {
                            providerMapEntry.result = result;
                        }).catch(error => {
                            providerMapEntry.error = error;
                        })
                    }
                    providerMap.set(provided as UnknownComponent, providerMapEntry);
                    return left(undefined);
                } else {
                    entity.components.set(provided, newData);
                    return getArg(provided);
                }
            }
        }
    });
}
*/
