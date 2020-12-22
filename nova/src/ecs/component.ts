import { Draft, immerable, Patch } from 'immer';
import * as t from 'io-ts';

export type ComponentData<C> = C extends Component<infer Data, any> ? Data : never;

export interface ComponentArgs<Data, Delta = Partial<Data>> {
    name?: string;
    type: t.Type<Data>;
    getDelta: (a: Data, b: Data, patches: Patch[]) => Delta | undefined;
    applyDelta: (data: Draft<Data>, delta: Delta) => void;
}

export class Component<Data, Delta = Patch[]> {
    [immerable] = true;
    readonly name?: string;
    readonly type: t.Type<Data>;
    readonly getDelta: (a: Data, b: Data, patches: Patch[]) => Delta | undefined;
    readonly applyDelta: (data: Draft<Data>, delta: Delta) => void;

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

