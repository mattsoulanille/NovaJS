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

interface SortableMarkers {
    readonly startMarker: Sortable,
    readonly endMarker: Sortable,
}

interface SortableArgs {
    readonly name?: string,
    readonly before?: Iterable<SortableMarkers>,
    readonly after?: Iterable<SortableMarkers>,
    readonly during?: Iterable<SortableMarkers>,
    
}

export interface Sortable extends SortableMarkers {
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
    readonly startMarker = this;
    readonly endMarker = this;

    constructor({name, before = [], after = [], during = []}: SortableArgs = {}) {
        if (name) {
            this.name = name;
        }

        this.before = new Set([
            // Run before the startMarkers of things in 'before'
            ...[...before].map(b => b.startMarker),
            // Run before the endMarkers of things in 'during'
            ...[...during].map(d => d.endMarker),
        ]);
        this.after = new Set([
            // Run after the endMarkers of things in 'after'
            ...[...after].map(a => a.endMarker),
            // Run after the startMarkers of things in 'during'
            ...[...during].map(d => d.startMarker),
        ]);

        const intersection = setIntersection(this.before, this.after);
        if (intersection.size > 0) {
            throw new Error(`[${[...intersection]}] are listed in both 'before'`
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

    constructor({ name, args, step, before, during, after, events }: SystemArgs<StepArgTypes>) {
        super({name, before, during, after});
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

/**
 * A `Phase` wraps a set of `System`s (or `Sortable`s) in between two dividers.
 *
 * To wrap Systems in a Phase, add them to the `contains` argument when
 * constructing the Phase. If the Phase is already constructed, add it to the
 * `during` argument of the System when constructing it. You can also manually
 * do this by setting a system to occur `after` a phase's `startMarker` and
 * `before` a phase's `endMarker`.
 *
 * Phases can overlap unless explicitly disallowed (by adding one Phase to the
 * `after` or `before` set of another. If Phase `A` is set to run before Phase
 * `B`, then all of the systems wrapped by Phase `A` will run before the systems
 * in phase `B`.
 */
export class Phase implements SortableMarkers {
    readonly name: string | undefined;
    readonly startMarker: Divider;
    readonly endMarker: Divider;

    constructor({name, before = [], contains = [], after = [], during = []}: SortableArgs & {
        contains?: Iterable<SortableMarkers>,
    } = {}) {
        if (name) {
            this.name = name;
        }
        this.startMarker = new Divider({
            name: name ? `${name}_start` : undefined,
            before: [...before, ...contains],
            during,
            after,
        });
        this.endMarker = new Divider({
            name: name ? `${name}_end` : undefined,
            before,
            during,
            after: [this.startMarker, ...contains],
        });
    }
}

/**
 * A `SystemSet` wraps `System`s in a new `Phase` and makes it easy to add them
 * all to the `World` with `world.addSystemSet`.
 */
export class SystemSet implements SortableMarkers {
    readonly phase: Phase;
    readonly systems: Iterable<System>;
    readonly startMarker: Divider;
    readonly endMarker: Divider;

    constructor({name, before, systems, after}: SortableArgs & {
        systems: Iterable<System>,
    }) {
        this.phase = new Phase({name, before, contains: systems, after})
        this.systems = systems;
        this.startMarker = this.phase.startMarker;
        this.endMarker = this.phase.endMarker;
    }
}
