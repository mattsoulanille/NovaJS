import { Component, ComponentData } from "./component";
import { Resource } from "./resource";
import { ComponentsOnly } from "./system";
import { subset } from "./utils";
import { WithComponents } from "./utils";
import { UUID } from "./world";

export type ComponentDataArgs<C> = {
    [K in keyof C]: ComponentData<C[K]>
}

export type QueryResults<Q> =
    Q extends Query<infer Components> ? ComponentDataArgs<Components>[] : never;

export type QueryArgTypes = Component<any, any> | typeof UUID;

/**
 * A query provides a way of iterating over all the Entities that have
 * a specified set of components.
 */
export class Query<ArgTypes extends readonly QueryArgTypes[]
    = readonly QueryArgTypes[]> {
    readonly components: Set<ComponentsOnly<ArgTypes>>;

    constructor(readonly args: ArgTypes, readonly name?: string) {
        this.components = new Set(this.args.filter(
            a => (a instanceof Component) && !(a instanceof Resource))
        ) as Set<ComponentsOnly<ArgTypes>>;
    }

    supportsEntity(entity: WithComponents) {
        return subset(this.components, new Set(entity.components.keys()));
    }

    toString() {
        return `Query(${this.name ?? this.args.map(c => c.toString())})`;
    }
}
