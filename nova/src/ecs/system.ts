import { Draft } from "immer";
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
    name?: string;
    readonly args: StepArgTypes;
    step: (...args: SystemStepArgs<StepArgTypes>) => void;
}

export class System<StepArgTypes extends readonly ArgTypes[] = readonly ArgTypes[]> {
    readonly name?: string;
    readonly args: StepArgTypes;
    readonly components: Set<ComponentsOnly<StepArgTypes>>;
    readonly resources: Set<ResourcesOnly<StepArgTypes>>;
    readonly queries: Set<QueriesOnly<StepArgTypes>>;
    readonly step: (...args: SystemStepArgs<StepArgTypes>) => void;

    constructor({ name, args, step }: SystemArgs<StepArgTypes>) {
        this.name = name;
        this.args = args;
        this.step = step;

        this.components = new Set(this.args.filter(
            a => (a instanceof Component) && !(a instanceof Resource))
        ) as Set<ComponentsOnly<StepArgTypes>>;

        this.resources = new Set(this.args.filter(
            a => (a instanceof Resource))
        ) as Set<ResourcesOnly<StepArgTypes>>;

        this.queries = new Set(this.args.filter(
            a => (a instanceof Query))
        ) as Set<QueriesOnly<StepArgTypes>>;
    }

    toString() {
        return `System(${this.name ?? this.args.map(a => a.toString())})`;
    }
}
