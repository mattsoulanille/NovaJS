import { Draft, immerable } from 'immer';
import * as t from 'io-ts';

export type ComponentData<C> = C extends Component<infer Data, any, any, any> ? Data : never;
export type UnknownComponent = Component<unknown, unknown, unknown, unknown>;

export interface ComponentArgs<Data, DataSerialized = Data,
    Delta = Partial<Data>, DeltaSerialized = Delta> {
    name: string;
    type?: t.Type<Data, DataSerialized>;
    deltaType?: t.Type<Delta, DeltaSerialized>;
    getDelta?: (a: Data, b: Data) => Delta | undefined;
    applyDelta?: (data: Draft<Data>, delta: Delta) => void;
    mutable?: boolean;
}

export class Component<Data, DataSerialized = Data,
    Delta = Partial<Data>, DeltaSerialized = Delta> {
    [immerable] = true;
    readonly name: string;
    readonly type?: t.Type<Data, DataSerialized>;
    readonly deltaType?: t.Type<Delta, DeltaSerialized>;
    readonly getDelta?: (a: Data, b: Data) => Delta | undefined;
    readonly applyDelta?: (data: Draft<Data>, delta: Delta) => void;
    readonly mutable: boolean;

    constructor({ name, type, deltaType, getDelta, applyDelta, mutable }:
        ComponentArgs<Data, DataSerialized, Delta, DeltaSerialized>) {
        this.name = name;
        this.type = type;
        this.deltaType = deltaType;
        this.getDelta = getDelta;
        this.applyDelta = applyDelta;
        this.mutable = mutable ?? false;
    }

    toString() {
        return `Component(${this.name})`;
    }
}

