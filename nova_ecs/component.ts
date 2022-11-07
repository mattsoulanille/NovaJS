import * as t from 'io-ts';
export type ComponentData<C> = C extends Component<infer Data> ? Data : never;
export type UnknownComponent = Component<unknown>;

const componentSymbol = Symbol('Component');
/**
 * A `Component` represents a type of data that can be attached to an
 * entity. Two components can have the same datatype, and they will appear
 * separately on the entity.  Components must have globally unique names
 * (TODO(mattSoulanille): Add namespacing to plugins).
 */
export class Component<Data> {
    // This symbol makes the component type and resource type not assignable to
    // each other.
    private readonly componentSymbol = componentSymbol;
    readonly type?: t.Type<Data>;
    readonly name: string;
    constructor(name: string) {
        this.name = name;
    }

    toString() {
        return `Component(${this.name})`;
    }
}

