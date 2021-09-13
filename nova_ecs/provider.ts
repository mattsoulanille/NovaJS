import { left, right } from "fp-ts/lib/Either";
import { applyPatches, createDraft, enableMapSet, enablePatches, finishDraft, Patch, setAutoFreeze } from "immer";
import { ArgData, ArgsToData, ArgTypes, GetEntity, QueryArgs, UUID } from "./arg_types";
import { Component, ComponentData, UnknownComponent } from "./component";
import { DeleteEvent } from "./events";
import { AnyModifier, Modifier } from "./modifier";
import { Optional } from "./optional";
import { Plugin } from "./plugin";
import { Query } from "./query";
import { Resource } from "./resource";
import { System } from "./system";
import { DefaultMap } from "./utils";

type AsyncProviderMapEntry = {
    promise: Promise<unknown>,
    complete: boolean,
    result?: unknown,
    error?: Error,
    patches: Patch[],
};

// TODO?: Use a weakmap with entities as keys instead of a map with uuids as keys?
export class AsyncProviderData {
    providers: DefaultMap<string /* Entity uuid */,
        Map<UnknownComponent /* Provided symbol */, AsyncProviderMapEntry>>
        = new DefaultMap(() => new Map());
    done: Promise<void> = Promise.resolve();
}

export const AsyncProviderResource = new Resource<AsyncProviderData>('AsyncProviderResource')

type ProviderUpdate = DefaultMap<string /* Entity uuid */,
    Map<AnyModifier /* Provider */, {
        dependencies: Set<UnknownComponent>,
        update: boolean,
        promise?: Promise<void>,
    }>>;

const ProviderUpdateResource = new Resource<ProviderUpdate>('ProviderUpdate');

function getUpdateData(providerUpdate: ProviderUpdate, uuid: string,
    provider: AnyModifier, update?: Iterable<Component<any>>) {
    const entityUpdate = providerUpdate.get(uuid);
    if (!entityUpdate.has(provider)) {
        entityUpdate.set(provider, {
            dependencies: new Set([...(update ?? [])]),
            update: false,
        });
    }
    return entityUpdate.get(provider)!;
}

export function Provide<Provided extends Component<any>, Args extends readonly ArgTypes[]>({ provided, update, factory, args }: {
    provided: Provided,
    update?: Iterable<Component<any>>,
    factory: (...args: ArgsToData<Args>) => ComponentData<Provided>,
    args: Args,
}) {
    const query = new Query([Optional(provided), GetEntity, UUID,
        ProviderUpdateResource, ...args] as const, `Provide ${provided.name}`);

    let provider: Modifier<QueryArgs<typeof query>, Provided>;
    provider = new Modifier({
        query,
        transform: (providedVal, entity, uuid, providerUpdate, ...factoryArgs) => {
            const updateData = getUpdateData(providerUpdate, uuid, provider, update);
            if (providedVal && !updateData.update) {
                return right(providedVal as ArgData<Provided>);
            }
            const newVal = factory(...factoryArgs);
            entity.components.set(provided, newVal);
            updateData.update = false;
            return right(newVal);
        }
    });
    return provider;
}

enablePatches();
enableMapSet();
setAutoFreeze(false);

// Used to force the cache to be re-checked by setting a component value.
const CheckCacheComponent = new Component<undefined>('CheckCacheComponent');

// TODO: Refactor this with AsyncSystem?
export function ProvideAsync<Provided extends Component<any>, Args extends readonly ArgTypes[]>({ provided, update, factory, args }: {
    provided: Provided,
    update?: Iterable<Component<any>>,
    factory: (...args: ArgsToData<Args>) => Promise<ComponentData<Provided>>,
    args: Args
}) {
    type Data = ComponentData<Provided>;
    const query = new Query([AsyncProviderResource, Optional(provided), GetEntity,
        UUID, ProviderUpdateResource, ...args] as const, `ProvideAsync ${provided.name}`);
    let provider: Modifier<QueryArgs<typeof query>, Provided>;

    provider = new Modifier({
        query,
        transform: (providerResource, providedVal, entity, uuid, providerUpdate, ...argData) => {
            const providerMap = providerResource.providers.get(uuid)!;
            const updateData = getUpdateData(providerUpdate, uuid, provider, update);
            const hasNewProvided = providerMap.has(provided as UnknownComponent);

            if (providedVal && !updateData.update && !hasNewProvided) {
                return right(providedVal as ArgData<Provided>);
            } else if (hasNewProvided && !updateData.update) {
                // Side effects in the factory function are supported, but there
                // is no guarantee that a provided component will appear in the world.
                // If a dependency changes before the factory completes, the component
                // will not be added, so be careful when using factory functions that
                // have side effects that need to be cleaned up by cleanup systems,
                // since those systems will not run if the component is never in the
                // world. In this case, it's best to consume the results of the async
                // provider with a synchronous provider, so only the results that
                // actually end up being provided have side-effects run on them.
                const providerMapEntry = providerMap
                    .get(provided as UnknownComponent)!;

                if (providerMapEntry.complete) {
                    providerMap.delete(provided as UnknownComponent);
                    if (providerMapEntry.error) {
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
                const providerMapEntry: AsyncProviderMapEntry = {
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
                    }).finally(() => {
                        // Invalidate the cache for this entity.
                        // TODO: Should there be a more 'official' way of doing this?
                        entity.components.set(CheckCacheComponent, undefined);
                    }),
                }
                providerResource.done = (async () => {
                    await providerResource.done
                    await providerMapEntry.promise;
                })();

                providerMap.set(provided as UnknownComponent, providerMapEntry);
                // Mark that we've re-provided (are re-providing) the result.
                // Do this here instead of when we return the result so that if
                // inputs change while it's being generated, the provider will run again.
                updateData.update = false;
                return left(undefined);
            }
        }
    });
    return provider;
}

const CleanupProviderResourcesSystem = new System({
    name: 'CleanupProviderResourcesSystem',
    events: [DeleteEvent],
    args: [UUID, AsyncProviderResource, ProviderUpdateResource] as const,
    step(uuid, asyncProviders, providerUpdates) {
        asyncProviders.providers.delete(uuid);
        providerUpdates.delete(uuid);
    }
});

export const ProvidePlugin: Plugin = {
    name: 'ProvidePlugin',
    build: (world) => {
        world.resources.set(AsyncProviderResource, new AsyncProviderData());
        const providerUpdate: ProviderUpdate
            = new DefaultMap(() => new Map());
        world.resources.set(ProviderUpdateResource, providerUpdate);
        world.entities.events.changeComponent.subscribe(
            ([uuid, _entity, component]) => {
                const entityUpdates = providerUpdate.get(uuid);

                for (const providerUpdates of entityUpdates.values()) {
                    if (!providerUpdates.update) {
                        // If it's not known to be updating, check it.
                        providerUpdates.update = providerUpdates.dependencies.has(component);
                    }
                }
            });
        world.addSystem(CleanupProviderResourcesSystem);
    }
}
