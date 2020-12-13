import { Component, ComponentArgs } from "./component";

export type ResourceData<C> = C extends Resource<infer Data, any> ? Data : never;

export interface ResourceArgs<Data, Delta> extends ComponentArgs<Data, Delta> {
    multiplayer?: boolean;
}

/**
 * Resources are not attached to Entities, and there is only a single instance
 * of each Resource in a world.
 */
export class Resource<Data, Delta = Partial<Data>>
    extends Component<Data, Delta> {

    readonly multiplayer: boolean

    constructor({ type, getDelta, applyDelta, multiplayer }: ResourceArgs<Data, Delta>) {
        super({ type, getDelta, applyDelta });
        this.multiplayer = multiplayer ?? true;
    }
}

