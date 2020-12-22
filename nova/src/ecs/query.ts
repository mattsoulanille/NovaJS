import { Component, ComponentData } from "./component";
import { ComponentsMap } from "./entity";
import { subset } from "./set_utils";
import { WithComponents } from "./util";

export type ComponentDataArgs<C> = {
    [K in keyof C]: ComponentData<C[K]>
}

export type QueryResults<Q> =
    Q extends Query<infer Components> ? ComponentDataArgs<Components>[] : never;

/**
 * A query provides a way of iterating over all the Entities that have
 * a specified set of components.
 */
export class Query<Components extends readonly Component<any, any>[]
    = readonly Component<any, any>[]> {
    constructor(readonly components: Components, readonly name?: string) { }

    supportsEntity(entity: WithComponents) {
        return subset(new Set(this.components), new Set(entity.components.keys()));
    }

    toString() {
        return `Query(${this.name ?? this.components.map(c => c.toString())})`;
    }
}
