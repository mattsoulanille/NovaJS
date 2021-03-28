import { left, right } from "fp-ts/lib/Either";
import { applyPatches, createDraft, enableMapSet, enablePatches, finishDraft, Patch, setAutoFreeze } from "immer";
import { ArgData, ArgsToData, ArgTypes, GetEntity, UUID } from "./arg_types";
import { Component, ComponentData, UnknownComponent } from "./component";
import { Modifier } from "./modifier";
import { Optional } from "./optional";
import { Plugin } from "./plugin";
import { Query } from "./query";
import { Resource } from "./resource";
import { DefaultMap } from "./utils";

type ProviderMapEntry = {
    promise: Promise<unknown>,
    complete: boolean,
    result?: unknown,
    error?: Error,
    patches: Patch[],
};

export class AsyncProviderData {
    providers: DefaultMap<string /* Entity uuid */,
        Map<UnknownComponent /* Provided symbol */, ProviderMapEntry>>
        = new DefaultMap(() => new Map());
    done: Promise<void> = Promise.resolve();
}

export const AsyncProviderResource = new Resource<AsyncProviderData>('AsyncProviderResource')

export function Provide<Provided extends Component<any>, Args extends readonly ArgTypes[]>({ provided, factory, args }: {
    provided: Provided,
    factory: (...args: ArgsToData<Args>) => ComponentData<Provided>,
    args: Args
}) {
    return new Modifier({
        query: new Query([Optional(provided), GetEntity, ...args] as const),
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

enablePatches();
enableMapSet();
setAutoFreeze(false);

// TODO: Refactor this with AsyncSystem?
export function ProvideAsync<Provided extends Component<any>, Args extends readonly ArgTypes[]>({ provided, factory, args }: {
    provided: Provided,
    factory: (...args: ArgsToData<Args>) => Promise<ComponentData<Provided>>,
    args: Args
}) {
    type Data = ComponentData<Provided>;
    return new Modifier({
        query: new Query([AsyncProviderResource, Optional(provided), GetEntity,
            UUID, ...args] as const),
        transform: (providerResource, providedVal, entity, uuid, ...argData) => {
            const providerMap = providerResource.providers.get(uuid)!;
            if (providedVal) {
                return right(providedVal as ArgData<Provided>);
            } else if (providerMap.has(provided as UnknownComponent)) {
                const providerMapEntry = providerMap
                    .get(provided as UnknownComponent)!;

                if (providerMapEntry.complete) {
                    if (providerMapEntry.error) {
                        providerMap.delete(provided as UnknownComponent);
                        throw providerMapEntry.error;
                    }

                    // This is a hack to force immer to treat args
                    // as if it were a draft. It greatly simplifies the rest
                    // of the code, but may break in the future.
                    (argData as any)[Symbol.for('immer-state')] = true;
                    applyPatches(argData, providerMapEntry.patches);

                    entity.components.set(provided, providerMapEntry.result as Data);

                    return right(providerMapEntry.result as ArgData<Provided>);
                }
                return left(undefined);
            } else {
                // TODO: Refactor with Async system
                const draftArgs = createDraft(argData);
                const newData = factory(...draftArgs as typeof argData);
                const providerMapEntry: ProviderMapEntry = {
                    complete: false,
                    patches: [],
                    promise: newData.then(result => {
                        providerMapEntry.result = result;
                        providerMapEntry.complete = true;
                        let patches: Patch[] | undefined;
                        finishDraft(draftArgs, (forwardPatches) => {
                            patches = forwardPatches;
                        });

                        if (!patches) {
                            throw new Error('Got no patches when calling async provider');
                        }
                        if (patches.length > 0) {
                            providerMapEntry.patches = patches;
                        }
                    }).catch(error => {
                        providerMapEntry.error = error;
                    })
                }
                providerResource.done = (async () => {
                    await providerResource.done
                    await providerMapEntry.promise;
                })();

                providerMap.set(provided as UnknownComponent, providerMapEntry);
                return left(undefined);
            }
        }
    });
}

export const ProvideAsyncPlugin: Plugin = {
    name: 'ProvideAsync',
    build: (world) => {
        world.resources.set(AsyncProviderResource, new AsyncProviderData());
    }
}
