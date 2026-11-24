import { ArgsToData, ArgTypes, SetComponent, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { StepEvent } from "nova_ecs/events";
import { Optional } from "nova_ecs/optional";
import { ChangeEvents } from "nova_ecs/provide";
import { ReadOnly } from "nova_ecs/read_only";
import { Resource } from "nova_ecs/resource";
import { System, SystemArgs } from "nova_ecs/system";
import { defaultWireSendPolicy } from "../../communication/wire_send_policy.js";

type Without<T, K> = Pick<T, Exclude<keyof T, K>>;
type ProvideFromCacheArgs<Data, Args extends readonly ArgTypes[]> =
    Without<SystemArgs<Args>, 'step' | 'events'> & {
        provided: Component<Data>,
        factory: (...args: ArgsToData<Args>) => Data | undefined,
        update?: Iterable<Component<any>>,
    };

/**
 * What a ProvideFromCache system does when its factory misses the game
 * data cache (#345, ruling of 2026-11-23, option c):
 *
 * - `strict`: throw a CacheMissError. A miss in a SIMULATION world is a
 *   staging bug: every way into a simulation world stages the entity's
 *   game data first, so the component attaches on the tick the entity
 *   arrives. A retry instead attaches it on a later tick that depends on
 *   this world's load timing, which is per-world state (the getCached
 *   determinism rule, docs/rollback_multiplayer.md finding 11).
 * - `recover`: leave the component off and retry next step, the old
 *   behaviour.
 *
 * makeSystem sets this resource on every simulation world from the
 * project's one dev/production switch, `NODE_ENV`, exactly as the wire's
 * send policy does (#272, wire_send_policy.ts): production recovers,
 * anything else (development, the spec runner, `node dist/server.js`) is
 * strict. The browser's simulation worker reads its bundle's NODE_ENV,
 * which esbuild bakes at build time (a Docker build bakes production);
 * the server's archive reads the process environment. A world without
 * the resource (the display world, whose caches are legitimately cold,
 * and hand-built test worlds) always recovers.
 */
export type CacheMissPolicy = 'strict' | 'recover';
export const CacheMissPolicyResource =
    new Resource<CacheMissPolicy>('CacheMissPolicy');

/** The policy of this process (or bundle), from NODE_ENV. */
export function defaultCacheMissPolicy(): CacheMissPolicy {
    return defaultWireSendPolicy() === 'strict' ? 'strict' : 'recover';
}

/** Thrown (under `strict`) when a simulation provider misses the cache. */
export class CacheMissError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CacheMissError';
    }
}

/**
 * Like Provide, but synchronous and cache-based: the factory reads
 * pre-warmed game data caches (getCached) and returns undefined to mean
 * "the data is not available yet".
 *
 * Entities inserted through the entity data loader always find their
 * data cached, so their components attach on the same tick they enter
 * the world — a requirement for deterministic resimulation. What a miss
 * does is the world's CacheMissPolicy: a simulation world in development
 * throws, so a staging gap is found where it happens; production and
 * the display world retry next step (getCached itself kicks off a
 * background load).
 */
export function ProvideFromCache<Data, Args extends readonly ArgTypes[]>(
    { name, provided, update, factory, args, before, after }: ProvideFromCacheArgs<Data, Args>) {
    const updateEvents = [...update ?? []].map(component => ChangeEvents.get(component));

    return new System({
        name,
        events: [StepEvent, ...updateEvents],
        before, after,
        args: [Optional(provided), SetComponent(provided), Optional(StepEvent),
            ReadOnly(Optional(CacheMissPolicyResource)), UUID, ...args] as const,
        step(providedValue, setComponent, step, policy, uuid, ...args) {
            if (providedValue !== undefined && step) {
                // Called by a normal step and the component already
                // exists; nothing to do.
                return;
            }
            const value = factory(...args as ArgsToData<Args>);
            if (value === undefined) {
                if (policy === 'strict') {
                    throw new CacheMissError(`${name}: game data for `
                        + `${provided.name} on ${uuid} is not cached in a `
                        + `simulation world (#345). Everything entering a `
                        + `simulation world must be staged first; a retry would `
                        + `attach it on a tick that depends on this world's `
                        + `load timing. This is a hard error in development; `
                        + `NODE_ENV=production retries next step instead.`);
                }
                return;
            }
            setComponent(value);
        }
    });
}
