import { Draft } from "immer";
import * as t from 'io-ts';
import { Component, ComponentData } from "./component";
import { Query, QueryResults } from "./query";
import { Resource, ResourceData } from "./resource";

// The arguments that `step` is called with
type StepArg<T> = Draft<QueryResults<T> | ComponentData<T> | ResourceData<T>>;
export type SystemStepArgs<Args> = {
    [K in keyof Args]: StepArg<Args[K]>
}

// Types for args that are used to define a system. Passed in a tuple.
export type ArgTypes = Component<any, any>
    | Query<readonly Component<any, any>[]>
    | Resource<any, any>;

type ResourcesOnly<T extends readonly [...unknown[]]> =
    Extract<T[number], Resource<any, any>>;

type QueriesOnly<T extends readonly [...unknown[]]> =
    Extract<T[number], Query<any>>;

type ComponentsOnly<T extends readonly [...unknown[]]> =
    Exclude<Extract<T[number], Component<any, any>>, Resource<any, any>>;

interface SystemArgs<StepArgTypes extends readonly ArgTypes[]> {
    readonly args: StepArgTypes;
    step: (...args: SystemStepArgs<StepArgTypes>) => void;
}

export class System<StepArgTypes extends readonly ArgTypes[] = ArgTypes[]> {
    readonly args: StepArgTypes;
    readonly components: Set<ComponentsOnly<StepArgTypes>>;
    readonly resources: Set<ResourcesOnly<StepArgTypes>>;
    readonly queries: Set<QueriesOnly<StepArgTypes>>;
    readonly step: (...args: SystemStepArgs<StepArgTypes>) => void;

    constructor({ args, step }: SystemArgs<StepArgTypes>) {
        this.args = args;
        this.step = step;

        this.components = new Set(this.args.filter(
            a => (a instanceof Component) && !(a instanceof Resource))
        ) as Set<ComponentsOnly<StepArgTypes>>;

        this.resources = new Set(this.args.filter(
            a => (a instanceof Resource))
        ) as Set<ResourcesOnly<StepArgTypes>>;

        this.queries = new Set(this.args.filter(
            a => (a instanceof Resource))
        ) as Set<QueriesOnly<StepArgTypes>>;
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

const BazResource = new Resource({
    type: t.type({ z: t.array(t.string) }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data
    },
    multiplayer: true
})

const FooBarQuery = new Query([FooComponent, BarComponent] as const);

const b = new System({
    args: [FooComponent, BarComponent, FooBarQuery, BazResource] as const,
    step: (foo, bar, a, baz) => {
        bar.y = foo.x.toString();
        for (let f of a) {
            baz.z.push(f[1].y)
        }
    }
});
type Test = [typeof FooComponent, typeof BarComponent, typeof BazResource, typeof FooBarQuery];
type R = ResourcesOnly<Test>;
type C = ComponentsOnly<Test>;
type Q = QueriesOnly<Test>;
type O = R | C;

