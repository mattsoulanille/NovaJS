import * as t from 'io-ts';

export type ComponentData<C> = C extends Component<infer Data, any> ? Data : never;

export interface ComponentArgs<Data, Delta = Partial<Data>> {
    name?: string;
    type: t.Type<Data>;
    getDelta: (a: Data, b: Data) => Delta | undefined;
    applyDelta: (data: Data, delta: Delta) => Data;
}

export class Component<Data, Delta = Partial<Data>> {
    readonly name?: string;
    readonly type: t.Type<Data>;
    readonly getDelta: (a: Data, b: Data) => Delta | undefined;
    readonly applyDelta: (data: Data, delta: Delta) => Data;

    constructor({ name, type, getDelta, applyDelta }: ComponentArgs<Data, Delta>) {
        this.name = name;
        this.type = type;
        this.getDelta = getDelta;
        this.applyDelta = applyDelta;
    }

    toString() {
        return `Component(${this.name ?? this.type.name})`;
    }
}

