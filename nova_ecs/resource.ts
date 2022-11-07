import { Component } from './component';

export type ResourceData<C> = C extends Resource<infer Data> ? Data : never;
export type UnknownResource = Resource<unknown>;

/**
 * A `Resource` is like a `Component` that can be attached to the `World`. There
 * is at most a single value for each type of Resource in a World, and any query
 * for that resource will return that value. Resources are useful for storing
 * global state that all systems should be able to access regardless of which
 * entity they are currently running on.
 */
export class Resource<Data> extends Component<Data> {
    override toString() {
        return `Resource(${this.name})`;
    }
}

