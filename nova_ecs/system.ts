import { ArgsToData, ArgTypes } from "./arg_types";
import { Component } from "./component";
import { Query } from "./query";
import { Resource } from "./resource";
import { WithComponents } from "./utils";


type ResourcesOnly<T extends readonly [...unknown[]]> =
    Extract<T[number], Resource<any, any, any, any>>;

type QueriesOnly<T extends readonly [...unknown[]]> =
    Extract<T[number], Query<any>>;

export type ComponentsOnly<T extends readonly [...unknown[]]> =
    Exclude<Extract<T[number], Component<any, any, any, any>>, Resource<any, any, any, any>>;

export interface BaseSystemArgs<StepArgTypes extends readonly ArgTypes[]> {
    readonly name: string;
    readonly args: StepArgTypes;
    readonly before?: Iterable<System | string>; // Systems that this system runs before
    readonly after?: Iterable<System | string>; // Systems that this system runs after
}
export interface SystemArgs<StepArgTypes extends readonly ArgTypes[]> extends BaseSystemArgs<StepArgTypes> {
    step: (...args: ArgsToData<StepArgTypes>) => void;
}

export class System<StepArgTypes extends readonly ArgTypes[] = readonly ArgTypes[]> {
    readonly name: string;
    readonly args: StepArgTypes;
    readonly components: ReadonlySet<ComponentsOnly<StepArgTypes>>;
    readonly resources: ReadonlySet<ResourcesOnly<StepArgTypes>>;
    readonly queries: ReadonlySet<QueriesOnly<StepArgTypes>>;
    readonly step: SystemArgs<StepArgTypes>['step'];
    readonly before: ReadonlySet<System | string>;
    readonly after: ReadonlySet<System | string>;
    readonly query: Query<StepArgTypes>;

    constructor({ name, args, step, before, after }: SystemArgs<StepArgTypes>) {
        this.name = name;
        this.args = args;
        this.step = step;
        this.before = new Set([...before ?? []]);
        this.after = new Set([...after ?? []]);

        this.components = new Set(this.args.filter(
            a => (a instanceof Component) && !(a instanceof Resource))
        ) as Set<ComponentsOnly<StepArgTypes>>;

        this.resources = new Set(this.args.filter(
            a => (a instanceof Resource))
        ) as Set<ResourcesOnly<StepArgTypes>>;

        this.queries = new Set(this.args.filter(
            a => (a instanceof Query))
        ) as Set<QueriesOnly<StepArgTypes>>;

        this.query = new Query(args);

    }

    supportsEntity(entity: WithComponents) {
        return this.query.supportsEntity(entity);
    }

    toString() {
        return `System(${this.name ?? this.args.map(a => a.toString())})`;
    }
}
