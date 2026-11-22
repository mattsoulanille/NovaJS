/**
 * ============================================================================
 * The background-prefetch machinery (#369, shared by #370)
 * ============================================================================
 *
 * A prefetch WARMS caches the client will read later — it never decides
 * what anything shows and never touches the simulation. Every prefetch
 * runs the same way:
 *
 *  - LOW PRIORITY. Each item waits for a slot of a small concurrency
 *    budget, then for an idle callback, so it never competes with a
 *    system entry, the frame pump or the display world's own loads. The
 *    budget can be SHARED between prefetches (PrefetchBudget), so two of
 *    them running at once still keep only a few requests in flight.
 *  - ONE RUN AT A TIME, keyed (by the system it warms). Cancelling a run
 *    stops it issuing anything new (requests already in flight just land
 *    in the cache); a run for the same key that finished stays finished.
 *  - FAILURES ARE SWALLOWED: one debug-level line per run.
 *
 * Subclasses (LandedUiPrefetch, NextHopPrefetch) decide WHEN a run starts
 * and WHAT it warms, through `startRun`, `step` and `each`.
 */

/** Defers a task to when the page is idle. */
export type IdleScheduler = (task: () => void) => void;

/**
 * requestIdleCallback where the platform has it (with a timeout, so a
 * busy page still gets through the list), else a macrotask.
 */
export const browserIdle: IdleScheduler = task => {
    const idle = (globalThis as {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number })
            => number,
    }).requestIdleCallback;
    if (idle) {
        idle(task, { timeout: 1000 });
    } else {
        setTimeout(task, 0);
    }
};

/**
 * The slots items run in: at most `concurrency` in flight, across every
 * prefetch that shares this budget.
 */
export class PrefetchBudget {
    inFlight = 0;
    readonly concurrency: number;
    private readonly waiting: (() => void)[] = [];

    constructor(concurrency = 4) {
        this.concurrency = Math.max(1, concurrency);
    }

    /** Resolves when a slot might be free (the waiter re-checks). */
    wait(): Promise<void> {
        return new Promise(resolve => this.waiting.push(resolve));
    }

    /** Wakes the next waiter (a slot was released). */
    release(): void {
        this.inFlight--;
        this.waiting.shift()?.();
    }

    /** Wakes every waiter, so cancelled ones can bow out. */
    wakeAll(): void {
        for (const wake of this.waiting.splice(0)) {
            wake();
        }
    }
}

export interface BackgroundPrefetchOptions {
    /** Where each item's start is deferred to (default: browserIdle). */
    schedule?: IdleScheduler;
    /** Items in flight at once (default 4); ignored with `budget`. */
    concurrency?: number;
    /** A budget shared with other prefetches (default: a private one). */
    budget?: PrefetchBudget;
    /** The one debug line a run with failures logs (default console.debug). */
    debug?: (message: string) => void;
}

/** Thrown into a cancelled run's pending steps; never logged. */
export class Cancelled extends Error { }

export interface PrefetchRun {
    /** What the run warms (a system id). */
    readonly key: string;
    cancelled: boolean;
    done: boolean;
    readonly promise: Promise<void>;
}

export abstract class BackgroundPrefetch {
    protected current?: PrefetchRun;
    private readonly schedule: IdleScheduler;
    private readonly budget: PrefetchBudget;
    private readonly debug: (message: string) => void;

    constructor(options: BackgroundPrefetchOptions = {}) {
        this.schedule = options.schedule ?? browserIdle;
        this.budget = options.budget
            ?? new PrefetchBudget(options.concurrency ?? 4);
        this.debug = options.debug ?? (message => console.debug(message));
    }

    /** Stops the current run issuing anything new. */
    cancel(): void {
        if (this.current && !this.current.done) {
            this.current.cancelled = true;
        }
        // Waiters re-check their run when woken, and bow out (another
        // prefetch's waiters sharing the budget simply wait again).
        this.budget.wakeAll();
    }

    /** The current run's settlement (resolves; never rejects). */
    get idle(): Promise<void> {
        return this.current?.promise ?? Promise.resolve();
    }

    /** Whether the current run finished every item. */
    get done(): boolean {
        return this.current?.done ?? false;
    }

    /**
     * Makes sure a run for `key` is going: nothing to do when the current
     * run is for `key` and still live (or finished); otherwise the current
     * run is cancelled and a new one started.
     */
    protected ensureRun(key: string, label: string,
        warm: (run: PrefetchRun, failures: unknown[]) => Promise<void>): void {
        const run = this.current;
        if (run && run.key === key && (!run.cancelled || run.done)) {
            return;
        }
        this.cancel();
        this.current = this.startRun(key, label, warm);
    }

    private startRun(key: string, label: string,
        warm: (run: PrefetchRun, failures: unknown[]) => Promise<void>):
        PrefetchRun {
        const failures: unknown[] = [];
        const run: { -readonly [K in keyof PrefetchRun]: PrefetchRun[K] } = {
            key, cancelled: false, done: false,
            promise: Promise.resolve(),
        };
        run.promise = warm(run, failures).then(() => {
            if (!run.cancelled) {
                run.done = true;
            }
        }, e => {
            if (!(e instanceof Cancelled)) {
                failures.push(e);
            }
        }).then(() => {
            if (failures.length > 0) {
                this.debug(`${label} prefetch for ${key}: `
                    + `${failures.length} item(s) failed (first: `
                    + `${String(failures[0])})`);
            }
        });
        return run;
    }

    /**
     * Runs `work` in a slot of the budget, started from an idle callback,
     * unless the run is cancelled first (then it throws Cancelled and
     * `work` never starts).
     */
    protected async step<T>(run: PrefetchRun, work: () => Promise<T>):
        Promise<T> {
        const { budget } = this;
        while (budget.inFlight >= budget.concurrency) {
            await budget.wait();
            if (run.cancelled) {
                throw new Cancelled();
            }
        }
        if (run.cancelled) {
            throw new Cancelled();
        }
        budget.inFlight++;
        try {
            await new Promise<void>(resolve => this.schedule(resolve));
            if (run.cancelled) {
                throw new Cancelled();
            }
            return await work();
        } finally {
            budget.release();
        }
    }

    /** Every item, each failure recorded rather than thrown. */
    protected async each(run: PrefetchRun, failures: unknown[],
        items: Iterable<() => Promise<unknown>>): Promise<void> {
        await Promise.all([...items].map(item =>
            this.step(run, item).catch(e => {
                if (e instanceof Cancelled) {
                    throw e;
                }
                failures.push(e);
            })));
    }
}
