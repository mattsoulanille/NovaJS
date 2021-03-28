import * as t from 'io-ts';
export type ComponentData<C> = C extends Component<infer Data> ? Data : never;
export type UnknownComponent = Component<unknown>;

export class Component<Data> {
    readonly type?: t.Type<Data>;
    readonly name: string;
    constructor(name: string) {
        this.name = name;
    }

    toString() {
        return `Component(${this.name})`;
    }
}

