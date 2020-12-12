import { Component } from "./component";
import { World } from "./world";
import * as t from 'io-ts';

type UnionToIntersection<T> =
    (T extends any ? (x: T) => any : never) extends
    (x: infer V) => any ? V : never;

// Get the type for a map from a component's name to its data
type ComponentNameDataMap<C> = UnionToIntersection<
    C extends Component<infer Name, infer Data, any>
    ? Record<Name, Data> : never>;

type QueryResults<Q> =
    Q extends Query<infer Components> ? ComponentNameDataMap<Components> : never;

type QueryNameResultsMap<Queries> = {
    [Name in keyof Queries]: QueryResults<Queries[Name]>
}

type SystemStepArgs<Components, Queries> = ComponentNameDataMap<Components>
    & QueryNameResultsMap<Queries>
    & { world: World; }

interface SystemArgs<Components extends Component<string, any, any>,
    QueryNames extends string,
    Queries extends { [Q in QueryNames]: Query<Component<Q, any, any>> }> {
    components: Set<Components>;
    queries: Queries;
    step: (args: SystemStepArgs<Components, Queries>) => void;
    multiplayer?: boolean;
}

export class System<Components extends Component<string, any, any>,
    QueryNames extends string,
    Queries extends { [Q in QueryNames]: Query<Component<Q, any, any>> }> {
    readonly components: Set<Components>;
    readonly queries: Queries;
    readonly step: (args: SystemStepArgs<Components, Queries>) => void;
    readonly multiplayer: boolean;

    constructor({ components, queries, step, multiplayer }: SystemArgs<Components, QueryNames, Queries>) {
        this.components = components;
        this.queries = queries;
        this.step = step;
        this.multiplayer = multiplayer ?? true;
    }
}

/**
 * A query provides a way of iterating over all the Entities that have
 * a specified set of components.
 */
export class Query<Components extends Component<string, any, any>> {
    constructor(readonly components: Set<Components>) { }
}

const FooComponent = new Component({
    name: 'foo',
    type: t.type({ x: t.number }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data;
    }
});

const BarComponent = new Component({
    name: 'bar',
    type: t.type({ y: t.string }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data;
    }
});

const FooBarQuery = new Query(new Set([FooComponent, BarComponent]));

const b = new System({
    components: new Set([FooComponent, BarComponent]),
    queries: { bla: FooBarQuery },
    step: ({ bar, foo, bla }) { }
});

// const a: System = {
//     components: ['foo', 'bar'],
//     multiplayer: true,
//     step: ({}:{ foo:})
// }
