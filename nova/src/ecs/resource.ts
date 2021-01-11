import { Component, ComponentArgs } from "./component";

export type ResourceData<C> = C extends Resource<infer Data, any> ? Data : never;
export type UnknownResource = Resource<unknown, unknown, unknown, unknown>;

export interface ResourceArgs<Data, DataSerialized = Data,
    Delta = Partial<Data>, DeltaSerialized = Delta> extends
    ComponentArgs<Data, DataSerialized, Delta, DeltaSerialized> {
    multiplayer?: boolean;
    mutable?: boolean;
}

/**
 * Resources are not attached to Entities, and there is only a single instance
 * of each Resource in a world.
 */
export class Resource<Data, DataSerialized = Data,
    Delta = Partial<Data>, DeltaSerialized = Delta> extends
    Component<Data, DataSerialized, Delta, DeltaSerialized> {

    readonly multiplayer: boolean;
    readonly mutable: boolean;
    constructor({ name, type, getDelta, applyDelta, multiplayer, mutable }:
        ResourceArgs<Data, DataSerialized, Delta, DeltaSerialized>) {
        super({ name, type, getDelta, applyDelta });
        this.multiplayer = multiplayer ?? true;
        this.mutable = mutable ?? false;
        if (this.multiplayer && this.mutable) {
            throw new Error('A resource must be immutable to be multiplayer');
        }
    }

    toString() {
        return `Resource(${this.name})`;
    }
}

