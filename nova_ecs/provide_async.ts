import { isDraft, original } from "immer";
import { ArgsToData, ArgTypes, GetEntity, UUID } from "./arg_types";
import { AsyncSystem } from "./async_system";
import { Component } from "./component";
import { DeleteEvent, StepEvent } from "./events";
import { Optional } from "./optional";
import { ChangeEvents, ProvidePlugin, Without } from "./provide";
import { Resource } from "./resource";
import { System, SystemArgs } from "./system";
import { Plugin } from "./plugin";

type AsyncProviderData =
    Map<string /* provider system name */,
        Map<string /* entity uuid */,
            Symbol | undefined /* running */>>;

export const AsyncProviderResource =
    new Resource<AsyncProviderData>('AsyncProviderResource');

export type ProvideAsyncArgs<Data, Args extends readonly ArgTypes[]> =
    Without<SystemArgs<Args>, 'step' | 'events'> & {
        provided: Component<Data>,
        factory: (...args: ArgsToData<Args>) => Data | Promise<Data>,
        update?: Iterable<Component<any>>,
        onError?: (err: Error) => void,
    };

export function ProvideAsync<Data, Args extends readonly ArgTypes[]>({ name, provided, update, factory, args, before, after, onError }: ProvideAsyncArgs<Data, Args>) {
    const updateEvents = [...update ?? []].map(component => ChangeEvents.get(component));

    return new AsyncSystem({
        name,
        events: [StepEvent, ...updateEvents],
        before, after,
        args: [Optional(provided), AsyncProviderResource, UUID,
            GetEntity, Optional(StepEvent), ...args] as const,
        skipIfApplyingPatches: true,
        exclusive: true,
        async step(providedValue, asyncProviderData, uuid, entity, step, ...args) {
            const originalProvidedValue = entity.components.get(provided);

            const originalData = originalIfDraft(asyncProviderData);
            const running = originalData.get(name)?.get(uuid);
            if ((running || providedValue !== undefined) && step) {
                return;
            }

            // Since all arguments are drafted, this must be set on the original entity.
            // Otherwise, it will only actually be set once this function completes.
            const runningSymbol = Symbol(); // Unique to this run

            if (!originalData.has(name)) {
                originalData.set(name, new Map());
            }
            // Set this on the original data so no new instances
            // of this provider will run on `step` events. Otherwise,
            // it only applies after this instance finishes.
            const originalDataForProvider = originalData.get(name)!;
            originalDataForProvider.set(uuid, runningSymbol);
            try {
                providedValue = await factory(...args);

                // If this instance of the provider is the most recent run,
                // then apply the provided data.
                if (originalDataForProvider.get(uuid) === runningSymbol) {

                    // If the provided value is changed while the provider is running,
                    // don't set the value.
                    // TODO: Is this desirable?
                    if (entity.components.get(provided) !== originalProvidedValue) {
                        return;
                    }
                    entity.components.set(
                        provided, originalIfDraft(providedValue));
                }
            } catch (e) {
                (onError ?? console.warn)(e);
            } finally {
                if (originalDataForProvider.get(uuid) === runningSymbol) {
                    // Set this on the draft so it gets applied after the async system
                    // runs and applies the changes that were made.
                    asyncProviderData.get(name)?.delete(uuid);
                }
            }
        }
    });
}

export function originalIfDraft<T>(val: T): T {
    if (isDraft(val)) {
        return original(val)!;
    }
    return val;
}

const AsyncProviderCleanup = new System({
    name: 'AsyncProviderCleanup',
    events: [DeleteEvent],
    args: [UUID, AsyncProviderResource] as const,
    step(deleted, asyncProviderData) {
        for (const entities of asyncProviderData.values()) {
            entities.delete(deleted);
        }
    }
});

export const ProvideAsyncPlugin: Plugin = {
    name: 'ProvidePlugin',
    build: (world) => {
        world.addPlugin(ProvidePlugin); // for component change events.
        world.resources.set(AsyncProviderResource, new Map());
        world.addSystem(AsyncProviderCleanup);
    }
}
