import { ArgsToData, ArgTypes } from "./arg_types";
import { EcsEvent, StepEvent, UnknownEvent } from "./events";
import { Query } from "./query";


export interface BaseSystemArgs<StepArgTypes extends readonly ArgTypes[]> {
    readonly name: string;
    readonly args: StepArgTypes;
    readonly before?: Iterable<System | string>; // Systems that this system runs before
    readonly after?: Iterable<System | string>; // Systems that this system runs after
    readonly events?: Iterable<EcsEvent<any, any>>; // Events that can trigger this system
}
export interface SystemArgs<StepArgTypes extends readonly ArgTypes[]> extends BaseSystemArgs<StepArgTypes> {
    step: (...args: ArgsToData<StepArgTypes>) => void;
}

export class System<StepArgTypes extends readonly ArgTypes[] = readonly ArgTypes[]> {
    readonly name: string;
    readonly args: StepArgTypes;
    readonly step: SystemArgs<StepArgTypes>['step'];
    readonly before: ReadonlySet<System | string>;
    readonly after: ReadonlySet<System | string>;
    readonly events: Set<UnknownEvent>;
    readonly query: Query<StepArgTypes>;

    constructor({ name, args, step, before, after, events }: SystemArgs<StepArgTypes>) {
        this.name = name;
        this.args = args;
        this.step = step;
        this.before = new Set([...before ?? []]);
        this.after = new Set([...after ?? []]);
        this.events = new Set([...events ?? [StepEvent]]) as Set<UnknownEvent>;
        this.query = new Query(args, name);
    }

    toString() {
        return `System(${this.name ?? this.args.map(a => a.toString())})`;
    }
}
