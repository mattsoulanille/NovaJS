import { ArgsToData, ArgTypes, GetEntity } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { StepEvent } from "nova_ecs/events";
import { Optional } from "nova_ecs/optional";
import { ChangeEvents } from "nova_ecs/provide";
import { System, SystemArgs } from "nova_ecs/system";

type Without<T, K> = Pick<T, Exclude<keyof T, K>>;
type ProvideFromCacheArgs<Data, Args extends readonly ArgTypes[]> =
    Without<SystemArgs<Args>, 'step' | 'events'> & {
        provided: Component<Data>,
        factory: (...args: ArgsToData<Args>) => Data | undefined,
        update?: Iterable<Component<any>>,
    };

/**
 * Like Provide, but synchronous and cache-based: the factory reads
 * pre-warmed game data caches (getCached) and may return undefined to
 * mean "the data is not available yet; try again next step".
 *
 * Entities inserted through the entity data loader always find their
 * data cached, so their components attach on the same tick they enter
 * the world — a requirement for deterministic resimulation. The retry
 * path only covers entities that bypass the loader (e.g. state arriving
 * from another peer), where getCached itself kicks off a background
 * load.
 */
export function ProvideFromCache<Data, Args extends readonly ArgTypes[]>(
    { name, provided, update, factory, args, before, after }: ProvideFromCacheArgs<Data, Args>) {
    const updateEvents = [...update ?? []].map(component => ChangeEvents.get(component));

    return new System({
        name,
        events: [StepEvent, ...updateEvents],
        before, after,
        args: [Optional(provided), GetEntity, Optional(StepEvent), ...args] as const,
        step(providedValue, entity, step, ...args) {
            if (providedValue !== undefined && step) {
                // Called by a normal step and the component already
                // exists; nothing to do.
                return;
            }
            const value = factory(...args as ArgsToData<Args>);
            if (value === undefined) {
                return;
            }
            entity.components.set(provided, value);
        }
    });
}
