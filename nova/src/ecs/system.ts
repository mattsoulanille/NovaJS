import { Component } from "./component";
import { World } from "./world";
import * as t from 'io-ts';

type UnionToIntersection<T> =
    (T extends any ? (x: T) => any : never) extends
    (x: infer V) => any ? V : never;

// Get the type for a map from a component's name to its data
type ComponentNameDataMap<C> = {
    [K in keyof C]: C[K] extends Component<infer Data, any> ? Data : never
}

type QueryResults<Q> =
    Q extends Query<infer Components> ? ComponentNameDataMap<Components> : never;

type QueryNameResultsMap<Queries> = {
    [Name in keyof Queries]: QueryResults<Queries[Name]>
}

type SystemStepArgs<Args> = ComponentNameDataMap<Args>
//& QueryNameResultsMap<Args>
//& { world: World; }



interface SystemArgs<StepKeys extends string,
    StepArgs extends {
        [key in StepKeys]:
        Component<any, any> | Query<Component<any, any>[]> }> {

    args: StepArgs;
    step: (args: SystemStepArgs<StepArgs>) => void;
    multiplayer?: boolean;
}

export class System<StepKeys extends string,
    StepArgs extends { [key in StepKeys]:
        Component<any, any> | Query<Component<any, any>[]> }> {

    readonly args: StepArgs;
    readonly step: (args: SystemStepArgs<StepArgs>) => void;
    readonly multiplayer: boolean;

    constructor({ args, step, multiplayer }: SystemArgs<StepKeys, StepArgs>) {
        this.args = args;
        this.step = step;
        this.multiplayer = multiplayer ?? true;
    }
}

/**
 * A query provides a way of iterating over all the Entities that have
 * a specified set of components.
 */
export class Query<ComponentTuple extends Component<any, any>[]> {
    constructor(readonly components: ComponentTuple) {

    }
}


const FooComponent = new Component({
    type: t.type({ x: t.number }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data;
    }
});

const BarComponent = new Component({
    type: t.type({ y: t.string }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data;
    }
});

//const FooBarQuery = new Query(new Set([FooComponent, BarComponent]));

const b = new System({
    args: { foo: FooComponent, bar: BarComponent },
    step: ({ bar, foo, }) { }
});

// const a: System = {
//     components: ['foo', 'bar'],
//     multiplayer: true,
//     step: ({}:{ foo:})
// }
