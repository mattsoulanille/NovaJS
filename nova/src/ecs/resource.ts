import { Patch } from "immer";
import { Component, ComponentArgs } from "./component";

export type ResourceData<C> = C extends Resource<infer Data, any> ? Data : never;

export interface ResourceArgs<Data, Delta> extends ComponentArgs<Data, Delta> {
    multiplayer?: boolean;
}

/**
 * Resources are not attached to Entities, and there is only a single instance
 * of each Resource in a world.
 */
export class Resource<Data, Delta = Patch[]>
    extends Component<Data, Delta> {

    readonly multiplayer: boolean;

    constructor({ name, type, getDelta, applyDelta, multiplayer }: ResourceArgs<Data, Delta>) {
        super({ name, type, getDelta, applyDelta });
        this.multiplayer = multiplayer ?? true;
    }

    toString() {
        return `Resource(${this.name ?? this.type.name})`;
    }
}

