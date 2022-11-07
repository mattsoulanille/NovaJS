import { ArgModifier, UnknownArgModifier } from "./arg_modifier";
import { ArgTypes } from "./arg_types";
import { BinSet, BinSetC } from "./bin_set";
import { Component, UnknownComponent } from "./component";
import { Entity } from "./entity";
import { Resource, UnknownResource } from "./resource";

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

    constructor(readonly args: QueryArgs, readonly name?: string) {
        const modifiers = args.filter(arg => arg instanceof ArgModifier) as UnknownArgModifier[];
        const modifierComponents = modifiers
            .map(modifier => modifier.query.components)
            .reduce((a, b) => new Set([...a, ...b]), new Set());

        const modifierResources = modifiers
            .map(modifier => modifier.query.resources)
            .reduce((a, b) => new Set([...a, ...b]), new Set());


        this.components = new Set([...(this.args.filter(
            a => (a instanceof Component)
                && !(a instanceof Resource)) as UnknownComponent[]),
        ...modifierComponents]);

        this.resources = new Set([...(this.args.filter(
            a => (a instanceof Resource)) as UnknownResource[]),
        ...modifierResources]);

        this.queries = [...(this.args.filter(
            (a): a is Query => (a instanceof Query)))];

        this.componentsBinSet = BinSetC.of(this.components);
    }

    supportsEntity(entity: Entity) {
        return this.componentsBinSet.isSubsetOf(entity.componentsBinSet);
    }

    toString() {
        return `Query(${this.name ?? 'unnamed'})`;
    }
}
