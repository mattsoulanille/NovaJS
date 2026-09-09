import type { ArgTypes } from "./arg_types.js";

const readOnlySymbol = Symbol('ReadOnly');

/**
 * Marks a system arg as read-only: the system resolves the arg but
 * never writes through it. The ambiguity analysis (ambiguities.ts)
 * treats a value two systems both merely read as unshared — their
 * relative order is unobservable through it — while a read of a value
 * the other system writes still counts as an ambiguity.
 *
 * `ReadOnly` is an annotation, not a guard: nothing stops a step from
 * mutating the value it resolves. Declare it only for args the system
 * genuinely does not write, including transitively (a resource holding
 * an object the step mutates is a write, not a read).
 *
 * The wrapper is transparent at resolution time: it delegates to the
 * wrapped arg and yields the same value, so `ReadOnly(x)` and `x` are
 * interchangeable in a system's args list. `Query` unwraps it when it
 * computes membership (which entities match) and staleness, and
 * `World.getArg` unwraps it when it resolves, so wrapping changes only
 * the ambiguity report.
 */
export class ReadOnlyArg<T extends ArgTypes> {
    // This symbol makes ReadOnlyArg not assignable to the arg it wraps
    // (or to Component / Resource).
    private readonly readOnlySymbol = readOnlySymbol;
    readonly arg: T;

    constructor(arg: T) {
        this.arg = arg;
    }

    toString() {
        return `ReadOnly(${String(this.arg)})`;
    }
}

export function ReadOnly<T extends ArgTypes>(arg: T): ReadOnlyArg<T> {
    return new ReadOnlyArg(arg);
}

export type UnknownReadOnlyArg = ReadOnlyArg<ArgTypes>;

/**
 * The arg a ReadOnly wrapper stands for, or the arg itself.
 * `unwrapReadOnly(Optional(x))` is `Optional(x)`.
 */
export function unwrapReadOnly<T extends ArgTypes>(arg: T): T {
    if (arg instanceof ReadOnlyArg) {
        return arg.arg as T;
    }
    return arg;
}
