import { ArgTypes } from "./arg_types";
import { Component, UnknownComponent } from "./component";
import { Modifier, UnknownModifier } from "./modifier";
import { Resource, UnknownResource } from "./resource";
import { subset, WithComponents } from "./utils";


const querySymbol = Symbol('Query');

/**
 * A query provides a way of iterating over all the Entities that have
 * a specified set of components.
 */
export class Query<QueryArgs extends readonly ArgTypes[]
    = readonly ArgTypes[]> {

    // Prevent query from being a subtype of EcsEvent
    private readonly _querySymbol = querySymbol;
    readonly components: ReadonlySet<UnknownComponent>;
    readonly resources: ReadonlySet<UnknownResource>;
    readonly queries: Query[];

    constructor(readonly args: QueryArgs, readonly name?: string) {
        const modifiers = args.filter(arg => arg instanceof Modifier) as UnknownModifier[];
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
    }

    supportsEntity(entity: WithComponents) {
        return subset(this.components, new Set(entity.components.keys()));
    }

    toString() {
        return `Query(${this.name ?? 'unnamed'})`;
    }
}
