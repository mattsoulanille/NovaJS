import { isDraft, original } from "immer";
import { ArgsToData, ArgTypes, GetEntity } from "./arg_types";
import { AsyncSystem } from "./async_system";
import { Component } from "./component";
import { EcsEvent, StepEvent } from "./events";
import { Optional } from "./optional";
import { Plugin } from "./plugin";
import { System, SystemArgs } from "./system";
import { DefaultMap } from "./utils";

export const ChangeEvents = new DefaultMap<Component<any>, EcsEvent<true>>(
    component => new EcsEvent(`${component.name} changed`));


type Without<T, K> = Pick<T, Exclude<keyof T, K>>;
type ProvideArgs<Data, Args extends readonly ArgTypes[]> =
    Without<SystemArgs<Args>, 'step' | 'events'> & {
        provided: Component<Data>,
        factory: (...args: ArgsToData<Args>) => Data,
        update?: Iterable<Component<any>>,
    };

export function Provide<Data, Args extends readonly ArgTypes[]>({ name, provided, update, factory, args, before, after }: ProvideArgs<Data, Args>) {
    const updateEvents = [...update ?? []].map(component => ChangeEvents.get(component));

    return new System({
        name,
        events: [StepEvent, ...updateEvents],
        before, after,
        args: [Optional(provided), GetEntity, Optional(StepEvent), ...args] as const,
        step(providedValue, entity, step, ...args) {
            if (providedValue !== undefined && step) {
                // If step is true, then this system was called by the world being
                // stepped. That means it wasn't called due to a component changing,
                // so do not re-create the provided value.
                return;
            }
            providedValue = factory(...args);

            entity.components.set(provided, providedValue);
        }
    });
}

type ProvideAsyncArgs<Data, Args extends readonly ArgTypes[]> =
    Without<SystemArgs<Args>, 'step' | 'events'> & {
        provided: Component<Data>,
        factory: (...args: ArgsToData<Args>) => Data | Promise<Data>,
        update?: Iterable<Component<any>>,
    };


export function ProvideAsync<Data, Args extends readonly ArgTypes[]>({ name, provided, update, factory, args, before, after }: ProvideAsyncArgs<Data, Args>) {
    const updateEvents = [...update ?? []].map(component => ChangeEvents.get(component));
    const providerRunning = new Component<Symbol>(`${name} running`);

    return new AsyncSystem({
        name,
        events: [StepEvent, ...updateEvents],
        before, after,
        args: [Optional(provided), Optional(providerRunning),
            GetEntity, Optional(StepEvent), ...args] as const,
        async step(providedValue, running, entity, step, ...args) {
            if ((running || providedValue !== undefined) && step) {
                return;
            }

            // Since all arguments are drafted, this must be set on the original entity.
            // Otherwise, it will only actually be set once this function completes.
            const runningSymbol = Symbol(); // Unique to this run
            const originalEntity = original(entity);
            originalEntity?.components.set(providerRunning, runningSymbol);
            providedValue = await factory(...args);
            if (originalEntity?.components.get(providerRunning) === runningSymbol) {
                // TODO: This may have issues when switching worlds.
                // Probably use a global resource to store whether it's running instead.
                entity.components.delete(providerRunning);
                entity.components.set(provided, originalIfDraft(providedValue));
            }
        }
    });
}

function originalIfDraft<T>(val: T): T {
    if (isDraft(val)) {
        return original(val)!;
    }
    return val;
}

export const ProvidePlugin: Plugin = {
    name: 'ProvidePlugin',
    build: (world) => {
        world.entities.events.changeComponent.subscribe(
            ([uuid, _entity, component]) => {
                world.emit(ChangeEvents.get(component), true, [uuid]);
            });

    }
}
