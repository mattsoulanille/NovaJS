import { Component, ComponentArgs } from "./component";

export type ResourceData<C> = C extends Resource<infer Data, any> ? Data : never;
export type UnknownResource = Resource<unknown, unknown, unknown, unknown>;

export interface ResourceArgs<Data, DataSerialized = Data,
    Delta = Partial<Data>, DeltaSerialized = Delta> extends
    ComponentArgs<Data, DataSerialized, Delta, DeltaSerialized> {
    multiplayer?: boolean;
}

/**
 * Resources are not attached to Entities, and there is only a single instance
 * of each Resource in a world.
 */
export class Resource<Data, DataSerialized = Data,
    Delta = Partial<Data>, DeltaSerialized = Delta> extends
    Component<Data, DataSerialized, Delta, DeltaSerialized> {

    readonly multiplayer: boolean;
    constructor({ name, type, getDelta, applyDelta, multiplayer }:
        ResourceArgs<Data, DataSerialized, Delta, DeltaSerialized>) {
        super({ name, type, getDelta, applyDelta });
        this.multiplayer = multiplayer ?? true;
    }

    toString() {
        return `Resource(${this.name})`;
    }
}

