import { ArgsToData, ArgTypes } from "./arg_types";
import { EcsEvent, StepEvent, UnknownEvent } from "./events";
import { Query } from "./query";
import { setIntersection } from "./utils";


export interface BaseSystemArgs<StepArgTypes extends readonly ArgTypes[]> extends SortableArgs {
    readonly name: string;
    readonly args: StepArgTypes;
    readonly events?: Iterable<EcsEvent<any, any>>; // Events that can trigger this system
}
export interface SystemArgs<StepArgTypes extends readonly ArgTypes[]> extends BaseSystemArgs<StepArgTypes> {
    step: (...args: ArgsToData<StepArgTypes>) => void;
}

// interface SortableRepresentative {
//     readonly sortableRepresentative: {start: Sortable, end: Sortable};
// }

interface SortableArgs {
    readonly name?: string,
    readonly before?: Iterable<Sortable>,
    readonly after?: Iterable<Sortable>,
}

export interface Sortable {
    readonly name?: string;
    readonly before: ReadonlySet<Sortable>;
    readonly after: ReadonlySet<Sortable>;
}

/**
 * A `Divider` is a `Sortable` element that can be referenced by `System`s (and
 * other sortables) in their `before` and `after` fields to order them.
 */
export class Divider implements Sortable {
    readonly name: string | undefined;
    readonly before: ReadonlySet<Sortable>;
    readonly after: ReadonlySet<Sortable>;
    //readonly sortableRepresentative: SortableRepresentative['sortableRepresentative'] = {start: this, end: this};

    constructor({name, before = [], after = []}: SortableArgs) {
        if (name) {
            this.name = name;
        }
        this.before = new Set([...before]);
        this.after = new Set([...after]);
        const intersection = setIntersection(this.before, this.after);
        if (intersection.size > 0) {
            const names = [...intersection].map(x => x.name);
            throw new Error(`[${names}] are listed in both 'before'`
                + ` and 'after' fields of ${this}`);
        }
    }

    toString() {
        return `Divider(${this.name ?? '<unnamed>'})`;
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
    override readonly name: string;
    readonly args: StepArgTypes;
    readonly step: SystemArgs<StepArgTypes>['step'];
    readonly events: Set<UnknownEvent>;
    readonly query: Query<StepArgTypes>;

    constructor({ name, args, step, before, after, events }: SystemArgs<StepArgTypes>) {
        super({name, before, after});
        this.name = name;
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
    readonly name: string | undefined;
    readonly start: Divider;
    readonly end: Divider;

    constructor({name, before = [], contains = [], after = []}: SortableArgs & {
        contains?: Iterable<Sortable>,
    }) {
        if (name) {
            this.name = name;
        }
        this.start = new Divider({
            name: name ? `${name}_start` : undefined,
            before: [...before, ...contains],
            after,
        });
        this.end = new Divider({
            name: name ? `${name}_end` : undefined,
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
