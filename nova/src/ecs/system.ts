import { Component } from "./component";
import { World } from "./world";
import * as t from 'io-ts';

type UnionToIntersection<T> =
    (T extends any ? (x: T) => any : never) extends
    (x: infer V) => any ? V : never;

// Get the type for a map from a component's name to its data

type ComponentData<C> = C extends Component<infer Data, any> ? Data : never;

type ComponentDataArgs<C> = {
    [K in keyof C]: ComponentData<C[K]>
}

type QueryResults<Q> =
    Q extends Query<infer Components> ? ComponentDataArgs<Components>[] : never;


type StepArg<T> = QueryResults<T> | ComponentData<T>;
type SystemStepArgs<Args> = {
    [K in keyof Args]: StepArg<Args[K]>
}
//ComponentDataArgs<Args>
//    | QueryResultArgs<Args>
//& { world: World; }

type ArgTypes = Component<any, any> | Query<readonly Component<any, any>[]>;

interface SystemArgs<StepArgs extends readonly ArgTypes[]> {
    readonly args: StepArgs;
    step: (...args: SystemStepArgs<StepArgs>) => void;
}

export class System<StepArgs extends readonly ArgTypes[]> {
    readonly args: StepArgs;
    readonly step: (...args: SystemStepArgs<StepArgs>) => void;

    constructor({ args, step }: SystemArgs<StepArgs>) {
        this.args = args;
        this.step = step;
    }
}

/**
 * A query provides a way of iterating over all the Entities that have
 * a specified set of components.
 */
export class Query<Components extends readonly Component<any, any>[]> {
    constructor(readonly components: Components) {

    }
}

/**
 * Resources are not attached to Entities, and there is only a single instance
 * of each Resource in a world.
 */
export class Resource<Data, Delta = Partial<Data>> {

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

const FooBarQuery = new Query([FooComponent, BarComponent] as const);

const b = new System({
    args: [FooComponent, BarComponent, FooBarQuery] as const,
    step: (foo, bar, a) => {
        for (let q of a) {

        }
    }
});

// const a: System = {
//     components: ['foo', 'bar'],
//     multiplayer: true,
//     step: ({}:{ foo:})
// }
