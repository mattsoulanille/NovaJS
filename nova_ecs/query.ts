import { ArgModifier, UnknownArgModifier } from "./arg_modifier";
import { ArgTypes } from "./arg_types";
import { BinSetC, BinSet } from "./bin_set";
import { Component, UnknownComponent } from "./component";
import { Entity } from "./entity";
import { Resource, UnknownResource } from "./resource";
import { subset } from "./utils";


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
