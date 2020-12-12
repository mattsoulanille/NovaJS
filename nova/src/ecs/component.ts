import * as t from 'io-ts';

interface ComponentArgs<Data, Delta = Partial<Data>> {
    type: t.Type<Data>;
    getDelta: (a: Data, b: Data) => Delta | undefined;
    applyDelta: (data: Data, delta: Delta) => Data;
}

export class Component<Data, Delta = Partial<Data>> {
    readonly type: t.Type<Data>;
    readonly getDelta: (a: Data, b: Data) => Delta | undefined;
    readonly applyDelta: (data: Data, delta: Delta) => Data;

    constructor({ type, getDelta, applyDelta }: ComponentArgs<Data, Delta>) {
        this.type = type;
        this.getDelta = getDelta;
        this.applyDelta = applyDelta;
    }
}

