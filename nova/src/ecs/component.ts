import { Draft, immerable, Immutable, Patch } from 'immer';
import * as t from 'io-ts';

export type ComponentData<C> = C extends Component<infer Data, any> ? Data : never;

export interface ComponentArgs<Data, Delta = unknown> {
    name: string;
    type?: t.Type<Data>;
    getDelta?: (a: Immutable<Data>, b: Immutable<Data>) => Delta | undefined;
    applyDelta?: (data: Draft<Data>, delta: Delta) => void;
}

export class Component<Data, Delta = Partial<Data>> {
    [immerable] = true;
    readonly name: string;
    readonly type?: t.Type<Data>;
    readonly getDelta?: (a: Immutable<Data>, b: Immutable<Data>) => Delta | undefined;
    readonly applyDelta?: (data: Draft<Data>, delta: Delta) => void;

    constructor({ name, type, getDelta, applyDelta }: ComponentArgs<Data, Delta>) {
        this.name = name;
        this.type = type;
        this.getDelta = getDelta;
        this.applyDelta = applyDelta;
    }

    toString() {
        return `Component(${this.name})`;
    }
}

