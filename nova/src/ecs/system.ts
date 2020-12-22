import { Draft } from "immer";
import { Component, ComponentData } from "./component";
import { Query, QueryResults } from "./query";
import { Resource, ResourceData } from "./resource";
import * as t from 'io-ts';
import { CommandsInterface, Commands, UUID } from "./world";
import { ComponentsMap } from "./entity";
import { subset } from "./set_utils";
import { WithComponents } from "./util";

// The arguments that `step` is called with
type StepArg<T> = Draft<QueryResults<T> | ComponentData<T> | ResourceData<T>> | CommandsObject<T> | UUIDData<T>;

type CommandsObject<T> = T extends typeof Commands ? CommandsInterface : never;
type UUIDData<T> = T extends typeof UUID ? string : never;

export type SystemStepArgs<Args> = {
    [K in keyof Args]: StepArg<Args[K]>
}

// Types for args that are used to define a system. Passed in a tuple.
export type ArgTypes = Component<any, any>
    | Query<readonly Component<any, any>[]>
    | Resource<any, any>
    | typeof Commands
    | typeof UUID;

type ResourcesOnly<T extends readonly [...unknown[]]> =
    Extract<T[number], Resource<any, any>>;

type QueriesOnly<T extends readonly [...unknown[]]> =
    Extract<T[number], Query<any>>;

type ComponentsOnly<T extends readonly [...unknown[]]> =
    Exclude<Extract<T[number], Component<any, any>>, Resource<any, any>>;

type QueryComponents<T> =
    T extends Query<infer Components> ? Components[number] : never;

const foo = new Component({
    name: 'foo',
    type: t.type({ foo: t.string }),
    getDelta: () => { return },
    applyDelta: () => { }
});

const bar = new Component({
    name: 'bar',
    type: t.type({ bar: t.string }),
    getDelta: () => { return },
    applyDelta: () => { }
});

const q = new Query([foo, bar]);
type f = QueryComponents<typeof q>
type g = ComponentsOnly<[typeof foo, typeof bar]>;

type AllComponents<T extends readonly [...unknown[]]> =
    ComponentsOnly<T> | QueryComponents<T[number]>

interface SystemArgs<StepArgTypes extends readonly ArgTypes[]> {
    name?: string;
    readonly args: StepArgTypes;
    step: (...args: SystemStepArgs<StepArgTypes>) => void;
    before?: Set<System>; // Systems that this system runs before
    after?: Set<System>; // Systems that this system runs after
}

export class System<StepArgTypes extends readonly ArgTypes[] = readonly ArgTypes[]> {
    readonly name?: string;
    readonly args: StepArgTypes;
    readonly components: Set<ComponentsOnly<StepArgTypes>>;
    readonly resources: Set<ResourcesOnly<StepArgTypes>>;
    readonly queries: Set<QueriesOnly<StepArgTypes>>;
    readonly allComponents: Set<AllComponents<StepArgTypes>>;
    readonly step: (...args: SystemStepArgs<StepArgTypes>) => void;
    readonly before: Set<System>;
    readonly after: Set<System>;

    constructor({ name, args, step, before, after }: SystemArgs<StepArgTypes>) {
        this.name = name;
        this.args = args;
        this.step = step;
        this.before = before ?? new Set();
        this.after = after ?? new Set();

        this.components = new Set(this.args.filter(
            a => (a instanceof Component) && !(a instanceof Resource))
        ) as Set<ComponentsOnly<StepArgTypes>>;

        this.resources = new Set(this.args.filter(
            a => (a instanceof Resource))
        ) as Set<ResourcesOnly<StepArgTypes>>;

        this.queries = new Set(this.args.filter(
            a => (a instanceof Query))
        ) as Set<QueriesOnly<StepArgTypes>>;

        this.allComponents = new Set([
            ...this.components,
            ...[...this.queries].reduce(
                (components: Component<unknown, unknown>[], query) =>
                    [...components, ...query.components], []
            ),
        ]) as Set<AllComponents<StepArgTypes>>;
    }

    supportsEntity(entity: WithComponents) {
        return subset(this.allComponents, new Set(entity.components.keys()));
    }

    toString() {
        return `System(${this.name ?? this.args.map(a => a.toString())})`;
    }
}
