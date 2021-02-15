import { ArgTypes } from "./arg_types";
import { Component } from "./component";
import { Resource } from "./resource";
import { subset, WithComponents } from "./utils";

type ComponentsOnly<T extends readonly [...unknown[]]> =
    Exclude<Extract<T[number], Component<any, any, any, any>>, Resource<any, any, any, any>>;

type ResourcesOnly<T extends readonly [...unknown[]]> =
    Extract<T[number], Resource<any, any, any, any>>;


/**
 * A query provides a way of iterating over all the Entities that have
 * a specified set of components.
 */
export class Query<QueryArgs extends readonly ArgTypes[]
    = readonly ArgTypes[]> {
    readonly components: Set<ComponentsOnly<QueryArgs>>;
    readonly resources: ReadonlySet<ResourcesOnly<QueryArgs>>;

    constructor(readonly args: QueryArgs, readonly name?: string) {
        this.components = new Set(this.args.filter(
            a => (a instanceof Component) && !(a instanceof Resource))
        ) as Set<ComponentsOnly<QueryArgs>>;

        this.resources = new Set(this.args.filter(
            a => (a instanceof Resource))
        ) as Set<ResourcesOnly<QueryArgs>>;
    }

    supportsEntity(entity: WithComponents) {
        return subset(this.components, new Set(entity.components.keys()));
    }

    toString() {
        return `Query(${this.name ?? 'unnamed'})`;
    }
}
