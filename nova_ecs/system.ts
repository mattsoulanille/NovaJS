import { ArgsToData, ArgTypes } from "./arg_types";
import { EcsEvent, StepEvent, UnknownEvent } from "./events";
import { Query } from "./query";
import { setIntersection } from "./utils";


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

// interface SortableRepresentative {
//     readonly sortableRepresentative: {start: Sortable, end: Sortable};
// }

interface SortableArgs {
    name: string,
    before?: Iterable<Sortable | string>,
    after?: Iterable<Sortable | string>,
}

export interface Sortable {
    readonly name: string;
    readonly before: ReadonlySet<Sortable | string>;
    readonly after: ReadonlySet<Sortable | string>;
}

/**
 * A `Divider` is a `Sortable` element that can be referenced by `System`s (and
 * other sortables) in their `before` and `after` fields to order them.
 */
export class Divider implements Sortable {
    readonly name: string;
    readonly before: ReadonlySet<Sortable | string>;
    readonly after: ReadonlySet<Sortable | string>;
    //readonly sortableRepresentative: SortableRepresentative['sortableRepresentative'] = {start: this, end: this};

    constructor({name, before = [], after = []}: SortableArgs) {
        this.name = name;
        this.before = new Set([...before]);
        this.after = new Set([...after]);
        const intersection = setIntersection(this.before, this.after);
        if (intersection.size > 0) {
            const names = [...intersection].map(
                x => typeof x === 'string' ? x : x.name);
            throw new Error(`[${names}] are listed in both 'before'`
                + ` and 'after' fields of ${this.name}`);
        }
    }
}

/**
 * A `System` is a function and a list of arg types (in a Query) that the
 * function requires. Systems should never store state.
 *
 * A System has several arguments, Only `name`, `args`, and `step` are required:
 * @param name the globally unique name of the system.
 * @param args a list of arg types to construct the System's Query. See query.ts
 *             for more details
 * @param step the function where the system's behavior is implemented.
 * @param before a list of other systems that this system runs before.
 * @param after a list of other systems that this system runs after.
 * @param events a list of events that this system responds to. By default, a
 *               system responds to the `StepEvent`.
 *
 */
export class System<StepArgTypes extends readonly ArgTypes[] = readonly ArgTypes[]> extends Divider {
    readonly args: StepArgTypes;
    readonly step: SystemArgs<StepArgTypes>['step'];
    readonly events: Set<UnknownEvent>;
    readonly query: Query<StepArgTypes>;

    constructor({ name, args, step, before, after, events }: SystemArgs<StepArgTypes>) {
        super({name, before, after});
        this.args = args;
        this.step = step;
        this.events = new Set([...events ?? [StepEvent]]) as Set<UnknownEvent>;
        this.query = new Query(args, name);
    }

    override toString() {
        return `System(${this.name ?? this.args.map(a => a.toString())})`;
    }
}

export class Phase {
    readonly name: string;
    readonly start: Divider;
    readonly end: Divider;

    constructor({name, before = [], contains = [], after = []}: SortableArgs & {
        contains?: Iterable<Sortable>,
    }) {
        this.name = name;
        this.start = new Divider({
            name: `${name}_start`,
            before: [...before, ...contains],
            after,
        });
        this.end = new Divider({
            name: `${name}_end`,
            before,
            after: [this.start, ...contains],
        });
    }
}

export class SystemSet {
    readonly phase: Phase;
    readonly systems: Iterable<System>;

    constructor({name, before, systems, after}: SortableArgs & {
        systems: Iterable<System>,
    }) {
        this.phase = new Phase({name, before, contains: systems, after})
        this.systems = systems;
    }
}
