import { original } from "immer";
import { ArgsToData, ArgTypes, GetEntity } from "./arg_types";
import { AsyncSystem } from "./async_system";
import { Component } from "./component";
import { EcsEvent, StepEvent } from "./events";
import { Optional } from "./optional";
import { Plugin } from "./plugin";
import { System } from "./system";
import { DefaultMap } from "./utils";

export const ChangeEvents = new DefaultMap<Component<any>, EcsEvent<true>>(
    component => new EcsEvent(`${component.name} changed`));

export function Provide<Data, Args extends readonly ArgTypes[]>({ name, provided, update, factory, args }: {
    name: string,
    provided: Component<Data>,
    update?: Iterable<Component<any>>,
    factory: (...args: ArgsToData<Args>) => Data,
    args: Args,
}) {
    const updateEvents = [...update ?? []].map(component => ChangeEvents.get(component));

    return new System({
        name,
        events: [StepEvent, ...updateEvents],
        args: [Optional(provided), GetEntity, Optional(StepEvent), ...args] as const,
        step(providedValue, entity, step, ...args) {
            if (providedValue !== undefined && step) {
                // If step is true, then this system was called by the world being
                // stepped. That means it wasn't called due to a component changing,
                // so do not re-create the provided value.
                return;
            }
            providedValue = factory(...args);
            if (providedValue instanceof Promise) {
                return;
            }

            entity.components.set(provided, providedValue);
        }
    });
}

export function ProvideAsync<Data, Args extends readonly ArgTypes[]>({ name, provided, update, factory, args }: {
    name: string,
    provided: Component<Data>,
    update?: Iterable<Component<any>>,
    factory: (...args: ArgsToData<Args>) => Data | Promise<Data>,
    args: Args,
}) {
    const updateEvents = [...update ?? []].map(component => ChangeEvents.get(component));
    const providerRunning = new Component<Symbol>(`${name} running`);

    return new AsyncSystem({
        name,
        events: [StepEvent, ...updateEvents],
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
                // TODO: This should actually be `entity.components.delete` but that
                // sometimes causes errors with immer (?).
                originalEntity?.components.delete(providerRunning);
                // This should actually be `entity.components.set` but that
                // causes errors with certain objects (e.g. PlanetData).
                originalEntity?.components.set(provided, providedValue);
            }
        }
    });
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
