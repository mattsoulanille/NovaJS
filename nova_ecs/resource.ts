import { Component } from './component';

export type ResourceData<C> = C extends Resource<infer Data> ? Data : never;
export type UnknownResource = Resource<unknown>;

/**
 * Resources are not attached to Entities, and there is only a single instance
 * of each Resource in a world.
 */
export class Resource<Data> extends Component<Data> {
    override toString() {
        return `Resource(${this.name})`;
    }
}

