import { ArgModifier, UnknownArgModifier } from "./arg_modifier.js";
import { ArgTypes, Entities, GetArg, GetEntity, GetWorld, RunQuery } from "./arg_types.js";
import { Component, UnknownComponent } from "./component.js";
import { Query } from "./query.js";
import { Resource, UnknownResource } from "./resource.js";
import { Sortable, System } from "./system.js";
import type { World } from "./world.js";

/**
 * Ambiguity report (after Bevy's `ambiguity detection`): the pairs of
 * systems whose relative order is decided by the World's tie-break
 * rather than by a declared `before` / `after` path, and which could
 * observe that order because their args reach the same state.
 *
 * A System's args declare what it can touch, but not whether it reads
 * or writes, so any shared component or resource counts as a
 * conflict. Some args imply more than they name (`accessSetOf`):
 * `GetEntity` hands the system the whole entity (every component);
 * `Entities`, `RunQuery`, `GetWorld` and `GetArg` reach anything in
 * the world — except a `GetArg` inside a modifier that declares what
 * it resolves (`ArgModifier.reaches`; `Optional(x)` reaches `x`).
 * `Emit` / `EmitNow` are ordinary resources: two emitters share the
 * event queue, whose FIFO order IS their relative order.
 *
 * Two systems that never respond to the same event are never in the
 * same run list, so their position in `world.systemNames` is
 * unobservable and they are not reported.
 */
export interface AccessSet {
    readonly components: ReadonlySet<UnknownComponent>;
    readonly resources: ReadonlySet<UnknownResource>;
    /** `GetEntity`: every component of the entity. */
    readonly allComponents: boolean;
    /** `Entities` / `RunQuery` / `GetWorld` / `GetArg`: anything at all. */
    readonly everything: boolean;
}

export interface Ambiguity {
    /** `a.name < b.name`, code unit order. */
    readonly a: System;
    readonly b: System;
    /**
     * What the pair shares, sorted: `component:X`, `resource:Y`,
     * `entity` (both take `GetEntity`) or `*` (one reaches everything).
     */
    readonly shared: readonly string[];
}

/** Everything `args` (and the queries and modifiers nested in them) reach. */
export function accessSetOf(args: readonly ArgTypes[]): AccessSet {
    const components = new Set<UnknownComponent>();
    const resources = new Set<UnknownResource>();
    let allComponents = false;
    let everything = false;
    const visit = (arg: ArgTypes) => {
        if (arg instanceof Component) {
            components.add(arg as UnknownComponent);
        } else if (arg instanceof Resource) {
            resources.add(arg as UnknownResource);
            if (arg === Entities || arg === RunQuery || arg === GetWorld) {
                everything = true;
            }
        } else if (arg instanceof Query) {
            arg.args.forEach(visit);
        } else if (arg instanceof ArgModifier) {
            const modifier = arg as UnknownArgModifier;
            if (modifier.reaches) {
                // A declared reach stands in for the raw GetArg the
                // transform resolves it with.
                modifier.query.args
                    .filter(nested => nested !== GetArg).forEach(visit);
                modifier.reaches.forEach(visit);
            } else {
                modifier.query.args.forEach(visit);
            }
        } else if (arg === GetEntity) {
            allComponents = true;
        } else if (arg === GetArg) {
            everything = true;
        }
        // Components (the name map), UUID and events reach no state.
    };
    args.forEach(visit);
    return { components, resources, allComponents, everything };
}

function touchesAnything(access: AccessSet): boolean {
    return access.everything || access.allComponents
        || access.components.size > 0 || access.resources.size > 0;
}

/** The state two access sets both reach, as `Ambiguity.shared`. */
export function sharedAccess(a: AccessSet, b: AccessSet): string[] {
    if ((a.everything && touchesAnything(b))
        || (b.everything && touchesAnything(a))) {
        return ['*'];
    }
    const shared: string[] = [];
    if (a.allComponents && b.allComponents) {
        shared.push('entity');
    } else if (a.allComponents || b.allComponents) {
        const named = a.allComponents ? b.components : a.components;
        for (const component of named) {
            shared.push(`component:${component.name}`);
        }
    } else {
        for (const component of a.components) {
            if (b.components.has(component)) {
                shared.push(`component:${component.name}`);
            }
        }
    }
    for (const resource of a.resources) {
        if (b.resources.has(resource)) {
            shared.push(`resource:${resource.name}`);
        }
    }
    return shared.sort();
}

/**
 * For every sortable, the set of sortables it is constrained to run
 * before (transitively, through markers and other systems). Only edges
 * between members of `sortables` count, like `topologicalSortList`.
 */
export function successors(sortables: readonly Sortable[]):
    Map<Sortable, Set<Sortable>> {
    const present = new Set(sortables);
    const direct = new Map<Sortable, Set<Sortable>>(
        sortables.map(s => [s, new Set<Sortable>()]));
    for (const sortable of sortables) {
        for (const before of sortable.before) {
            if (present.has(before)) {
                direct.get(sortable)!.add(before);
            }
        }
        for (const after of sortable.after) {
            if (present.has(after)) {
                direct.get(after)!.add(sortable);
            }
        }
    }
    const closure = new Map<Sortable, Set<Sortable>>();
    for (const start of sortables) {
        const seen = new Set<Sortable>();
        const stack = [start];
        while (stack.length > 0) {
            for (const next of direct.get(stack.pop()!)!) {
                if (!seen.has(next)) {
                    seen.add(next);
                    stack.push(next);
                }
            }
        }
        closure.set(start, seen);
    }
    return closure;
}

function shareAnEvent(a: System, b: System): boolean {
    for (const event of a.events) {
        if (b.events.has(event)) {
            return true;
        }
    }
    return false;
}

function byName(a: Ambiguity, b: Ambiguity): number {
    return a.a.name < b.a.name ? -1 : a.a.name > b.a.name ? 1
        : a.b.name < b.b.name ? -1 : a.b.name > b.b.name ? 1 : 0;
}

/**
 * The ambiguous pairs among `sortables` (systems and markers, as the
 * World registers them), sorted by name.
 */
export function findAmbiguities(sortables: readonly Sortable[]): Ambiguity[] {
    const systems = sortables.filter((s): s is System => s instanceof System);
    const reach = successors(sortables);
    const access = new Map(systems.map(s => [s, accessSetOf(s.args)]));
    const ambiguities: Ambiguity[] = [];
    for (let i = 0; i < systems.length; i++) {
        for (let j = i + 1; j < systems.length; j++) {
            const first = systems[i]!;
            const second = systems[j]!;
            if (!shareAnEvent(first, second)
                || reach.get(first)!.has(second)
                || reach.get(second)!.has(first)) {
                continue;
            }
            const shared = sharedAccess(access.get(first)!, access.get(second)!);
            if (shared.length === 0) {
                continue;
            }
            const [a, b] = first.name < second.name
                ? [first, second] : [second, first];
            ambiguities.push({ a, b, shared });
        }
    }
    return ambiguities.sort(byName);
}

/** `findAmbiguities` over everything the world has registered. */
export function reportAmbiguities(world: World): Ambiguity[] {
    return findAmbiguities(world.registeredSortables);
}

/** One line per pair: `A <-> B: shared...`, plus a count. */
export function formatAmbiguities(ambiguities: readonly Ambiguity[]): string {
    const lines = ambiguities.map(({ a, b, shared }) =>
        `${a.name} <-> ${b.name}: ${shared.join(', ')}`);
    lines.push(`${ambiguities.length} ambiguous pair(s)`);
    return lines.join('\n');
}
