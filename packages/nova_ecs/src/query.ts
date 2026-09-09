import { ArgModifier, UnknownArgModifier } from "./arg_modifier.js";
import { ArgTypes, GetArg } from "./arg_types.js";
import { BinSet, BinSetC } from "./bin_set.js";
import { Component, UnknownComponent } from "./component.js";
import { Entity } from "./entity.js";
import { Resource, UnknownResource } from "./resource.js";
import { unwrapReadOnly } from "./read_only.js";

const querySymbol = Symbol('Query');

/**
 * A query provides a way of iterating over all the Entities that have
 * a given set of components. It also allows access to other kinds of data such
 * as Resources.
 * 
 * nova_ecs provides several convenience resources by default:
 * - Entities: A map of all the entities in the world.
 * - Emit: A function that emits an event to the world.
 * - EmitNow: A function that emits an event to the world to be immediately run.
 * - RunQuery: A function to run a query in the world.
 * - GetWorld: The world itself.
 *
 * There are also other values, which are not resources, that queries can get:
 * - GetEntity: The current entity.
 * - Components: A map of the entity's components.
 * - UUID: The entity's uuid.
 * - GetArg: A function that gets a given arg type from the current entity.
 * - Any EcsEvent: Queries are also used for getting the value of an event. If a
 *                 system responds to an event, then putting that event in the 
 *                 query will cause it to return that event's value
 *                 (if present). See `events.ts` for details and a list of
 *                 events available by default.
 *
 * Sometimes, it's necessary to express a more complicated requirement than
 * "entities with these components". ArgModifiers can help with this, but they
 * can have a small performance penalty. It's still unclear whether this
 * approach is a good solution, though. See `arg_modifier.ts` for details.
 * - Optional(arg): Makes an arg type in a query optional.
 * - FirstAvailable(arg, ...): Returns the first available arg.
 * - Without(arg): Prevents the query from returning values if `arg` resolves 
 *                 to a value. `arg` is usually a component in this case.
 *
 * Sometimes, it's necessary to run a system only once per step. A common
 * pattern here is to make the system depend on the `SingletonComponent` and
 * store any shared data it modifies in Resources. The world always has a single
 * entity with this component, so the system will run once on that entity. Other
 * systems that run on different entities can access the results of the first
 * system by checking the Resources it modified.
 *
 * Queries can also be nested, and a nested query will run on _all_ the entities
 * in the world. This provides a way to compare entities against each other. For
 * an example of this, see the CollisionSystem in NovaJS.
 *
 * For a full list of what a query can resolve, take a look at the `getArg`
 * function in `world.ts`, the default resources set in the `World`'s
 * constructor, and the default events in `events.ts`.
 * 
 * https://github.com/mattsoulanille/NovaJS/blob/jsdocs/nova/src/nova_plugin/collisions_plugin.ts#L261-L264
 */
export class Query<QueryArgs extends readonly ArgTypes[]
    = readonly ArgTypes[]> {

    // Prevent query from being a subtype of EcsEvent
    private readonly _querySymbol = querySymbol;
    readonly components: ReadonlySet<UnknownComponent>;
    readonly resources: ReadonlySet<UnknownResource>;
    readonly queries: Query[];
    readonly componentsBinSet: BinSet<UnknownComponent>;
    /**
     * The staleness set: every component whose add / change / delete on
     * an entity can change this query's per-entity results. The query
     * cache invalidates a cached result only for events on these
     * components (component-indexed dispatch); `null` means unknown
     * (some ArgModifier can resolve arbitrary args at transform time),
     * which makes the cache conservatively invalidate on every
     * component event.
     *
     * This is a superset of `components` (the membership set): it also
     * carries components resolved through modifiers, e.g. the wrapped
     * arg of `Optional`, which affects results but not membership.
     * Args that resolve to live or stable references contribute
     * nothing: nested Query results (the cache updates the same array
     * in place), GetEntity, Components, UUID, GetArg (fetches fresh on
     * every call), EcsEvents (never cached across events), and
     * Resources (invalidated by the cache's own resource subscription).
     */
    readonly referencedComponents: ReadonlySet<UnknownComponent> | null;

    constructor(readonly args: QueryArgs, readonly name?: string) {
        // ReadOnly wrappers are annotations for the ambiguity report;
        // unwrap them so membership, resources, and staleness see the
        // arg the system actually resolves.
        const unwrappedArgs = args.map(unwrapReadOnly);
        const modifiers = unwrappedArgs.filter(
            arg => arg instanceof ArgModifier) as UnknownArgModifier[];
        const modifierComponents = modifiers
            .map(modifier => modifier.query.components)
            .reduce((a, b) => new Set([...a, ...b]), new Set());

        const modifierResources = modifiers
            .map(modifier => modifier.query.resources)
            .reduce((a, b) => new Set([...a, ...b]), new Set());


        this.components = new Set([...(unwrappedArgs.filter(
            a => a instanceof Component) as UnknownComponent[]),
        ...modifierComponents]);

        this.resources = new Set([...(unwrappedArgs.filter(
            a => (a instanceof Resource)) as UnknownResource[]),
        ...modifierResources]);

        this.queries = [...(unwrappedArgs.filter(
            (a): a is Query => (a instanceof Query)))];

        this.componentsBinSet = BinSetC.of(this.components);

        // Direct args: only modifiers can hide component reads (their
        // transform result is cached). A direct GetArg arg resolves to
        // a closure that fetches fresh on every call, so unlike a
        // GetArg inside a modifier query it does not poison the set.
        let referenced: Set<UnknownComponent> | null =
            new Set(this.components);
        for (const modifier of modifiers) {
            const modifierReferenced = modifier.referencedComponents;
            if (modifierReferenced === null) {
                referenced = null;
                break;
            }
            for (const component of modifierReferenced) {
                referenced.add(component);
            }
        }
        this.referencedComponents = referenced;
    }

    supportsEntity(entity: Entity) {
        return this.componentsBinSet.isSubsetOf(entity.componentsBinSet);
    }

    toString() {
        return `Query(${this.name ?? 'unnamed'})`;
    }
}

/**
 * The components an arg's resolved value can depend on for a given
 * entity, i.e. the arg's contribution to `Query.referencedComponents`.
 * `null` means unknown (invalidate on everything). Used by modifier
 * factories (e.g. `Optional`) to declare the args their transform
 * resolves dynamically.
 */
export function referencedComponentsOfArg(arg: ArgTypes):
    ReadonlySet<UnknownComponent> | null {
    if (arg instanceof Component) {
        return new Set([arg as UnknownComponent]);
    }
    if (arg instanceof ArgModifier) {
        return (arg as UnknownArgModifier).referencedComponents;
    }
    if (arg === GetArg) {
        // A raw getArg baked into a cached result can read anything.
        // (As a direct system arg it is harmless — it fetches fresh on
        // every call — and Query's constructor never reaches this case
        // for direct args; only modifier factories declaring transform
        // reads do, where the fetched value IS cached.)
        return null;
    }
    // Resources, nested Queries, EcsEvents, GetEntity, Components, UUID:
    // live/stable references or handled by their own invalidation.
    return new Set();
}
