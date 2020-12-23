import { UUID } from "./arg_types";
import { Component } from "./component";
import { Resource } from "./resource";
import { ComponentsOnly } from "./system";
import { subset, WithComponents } from "./utils";


export type QueryArgTypes = Component<any, any> | typeof UUID;

/**
 * A query provides a way of iterating over all the Entities that have
 * a specified set of components.
 */
export class Query<QueryArgs extends readonly QueryArgTypes[]
    = readonly QueryArgTypes[]> {
    readonly components: Set<ComponentsOnly<QueryArgs>>;

    constructor(readonly args: QueryArgs, readonly name?: string) {
        this.components = new Set(this.args.filter(
            a => (a instanceof Component) && !(a instanceof Resource))
        ) as Set<ComponentsOnly<QueryArgs>>;
    }

    supportsEntity(entity: WithComponents) {
        return subset(this.components, new Set(entity.components.keys()));
    }

    toString() {
        return `Query(${this.name ?? this.args.map(c => c.toString())})`;
    }
}
