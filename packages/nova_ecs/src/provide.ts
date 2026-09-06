import { ArgsToData, ArgTypes, GetEntity } from "./arg_types.js";
import { Component } from "./component.js";
import { EcsEvent, StepEvent } from "./events.js";
import { SyncSubscription } from "./event_map.js";
import { Optional } from "./optional.js";
import { Plugin } from "./plugin.js";
import { Resource } from "./resource.js";
import { System, SystemArgs } from "./system.js";
import { DefaultMap } from "./utils.js";

export const ChangeEvents = new DefaultMap<Component<any>, EcsEvent<true>>(
    component => new EcsEvent(`${component.name} changed`));

export type Without<T, K> = Pick<T, Exclude<keyof T, K>>;
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

// Keeps track of whether entity change events are being re-emitted into
// the world.
const ChangeEventsSubscription =
    new Resource<SyncSubscription>('ChangeEventsSubscription');

export const ProvidePlugin: Plugin = {
    name: 'ProvidePlugin',
    build: (world) => {
        // Subscribe to change events of components on entities. This
        // only fires when a component is REASSIGNED (components.set), not
        // when its data is mutated in place, so a provider's `update`
        // dependencies re-derive on reassignment only. Callers that
        // mutate in place and need a re-derive must delete or reassign
        // the provided component themselves (spaceport.ts after the
        // outfitter, fire_weapon_plugin WeaponsComponentProvider); the
        // tracker issue on Provide re-derivation covers doing better.
        if (!world.resources.has(ChangeEventsSubscription)) {
            const unsubscribe = world.entities.events.changeComponent.subscribe(
                ([uuid, _entity, component]) => {
                    world.emit(ChangeEvents.get(component), true, [uuid]);
                });
            world.resources.set(ChangeEventsSubscription, unsubscribe);
        }
    }
}
