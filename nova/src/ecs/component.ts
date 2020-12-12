import * as t from 'io-ts';

interface ComponentArgs<Name extends string, Data, Delta = Partial<Data>> {
    name: Name;
    type: t.Type<Data>;
    getDelta: (a: Data, b: Data) => Delta | undefined;
    applyDelta: (data: Data, delta: Delta) => Data;
}

export class Component<Name extends string, Data, Delta = Partial<Data>> {
    readonly name: Name;
    readonly type: t.Type<Data>;
    readonly getDelta: (a: Data, b: Data) => Delta | undefined;
    readonly applyDelta: (data: Data, delta: Delta) => Data;

    constructor({ name, type, getDelta, applyDelta }: ComponentArgs<Name, Data, Delta>) {
        this.name = name;
        this.type = type;
        this.getDelta = getDelta;
        this.applyDelta = applyDelta;
    }
}

