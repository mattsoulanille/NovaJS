/**
 * ============================================================================
 * Session generations: mutual exclusion between exit-to-title and the
 * transitions still in flight
 * ============================================================================
 *
 * A system transition (browser.ts's jumpTo / enterSystem) is a long chain
 * of awaits — the destination world build, a fresh Worker, a room join,
 * the arrival insertions — and nothing used to stop the player leaving
 * the game in the middle of it. Escape is accepted whenever no menu owns
 * the keyboard, which is exactly the state during a jump's white screen;
 * `teardownGame` then reset every piece of module state, after which the
 * transition resumed and finished building a world on top of the title
 * screen: a frozen space scene drawn over the title, a Worker nobody could
 * close, and a room the session had already left (review F2, issue #30).
 *
 * The fix is a GENERATION COUNTER. `begin()` opens a session; `end()`
 * closes it and bumps the counter. Every transition runs under a
 * {@link TransitionScope} captured at its start, and calls `check()` after
 * each await (or runs a long wait through `race()`): a scope whose
 * generation is no longer current throws {@link SessionEndedError}, which
 * the transition's own cleanup turns into "terminate the worker I made,
 * put the escorts back" — and which the recovery paths recognise as "do
 * not try to recover, there is no session to recover into".
 *
 * `end()` also RETURNS A PROMISE that settles once every transition it
 * invalidated has finished bailing out, so the teardown can wait for the
 * rosters to be quiet before it snapshots and resets them. A transition
 * that is stuck on a wait that never settles would hold the teardown
 * hostage, which is why the long waits go through `race()`: the session
 * ending rejects them promptly.
 *
 * Client-local module: nothing here touches simulation state.
 */

/** Thrown by a transition whose session ended while it was in flight. */
export class SessionEndedError extends Error {
    constructor() {
        super('The game session ended while a transition was in flight');
        this.name = 'SessionEndedError';
    }
}

/** Thrown by {@link TransitionScope.race} when a bounded wait expires. */
export class TransitionTimeoutError extends Error {
    constructor(what: string, timeoutMs: number) {
        super(`Timed out after ${timeoutMs}ms waiting for ${what}`);
        this.name = 'TransitionTimeoutError';
    }
}

/**
 * The handle a transition holds on the session it runs in.
 */
export interface TransitionScope {
    /** The session generation this transition belongs to. */
    readonly generation: number;
    /** Whether the session is still the one this transition started in. */
    readonly live: boolean;
    /**
     * Throws {@link SessionEndedError} unless the session is still live.
     * Call after every await that could outlive an exit-to-title.
     */
    check(): void;
    /**
     * Awaits `promise`, but settles early — with {@link SessionEndedError} —
     * if the session ends first, and with {@link TransitionTimeoutError}
     * once `timeoutMs` (when given) has elapsed. The underlying promise
     * is left to settle on its own; its result is simply ignored.
     */
    race<T>(promise: Promise<T>,
        bound?: { timeoutMs: number, what: string }): Promise<T>;
    /**
     * Registers a cleanup that {@link SessionTransitions.run} performs if
     * (and only if) the transition rejects — whatever the reason, the
     * session ending included. Run in reverse registration order; a
     * cleanup that throws is logged and does not stop the others. The
     * hook for "I made a Worker; terminate it if this does not complete".
     */
    onFailure(cleanup: () => void | Promise<void>): void;
}

export class SessionTransitions {
    private generation = 0;
    private open = false;
    /** Promises of the transitions running under the current generation. */
    private inFlight = new Set<Promise<unknown>>();
    /** Rejecters for the `race()` waits of the current generation. */
    private endListeners = new Set<() => void>();

    /** The current generation (0 before the first session). */
    get current(): number {
        return this.generation;
    }

    /** Whether a session is open. */
    get isOpen(): boolean {
        return this.open;
    }

    /** How many transitions are in flight under the current generation. */
    get inFlightCount(): number {
        return this.inFlight.size;
    }

    /**
     * Opens a session: a fresh generation. Anything still in flight from a
     * previous session was already invalidated by its `end()`.
     */
    begin(): number {
        this.generation++;
        this.open = true;
        return this.generation;
    }

    /**
     * Closes the session. Every scope of the closing generation goes dead
     * at once (their next `check()` throws, their `race()` waits reject),
     * and the returned promise settles once all of them have finished
     * bailing out — never rejects, whatever they threw.
     */
    end(): Promise<void> {
        this.generation++;
        this.open = false;
        const listeners = [...this.endListeners];
        this.endListeners.clear();
        for (const listener of listeners) {
            listener();
        }
        const settling = [...this.inFlight];
        this.inFlight.clear();
        return Promise.allSettled(settling).then(() => undefined);
    }

    /** A scope for the CURRENT generation. */
    scope(): TransitionScope {
        return this.scopeWithCleanups().scope;
    }

    private scopeWithCleanups():
        { scope: TransitionScope, cleanups: Array<() => void | Promise<void>> } {
        const generation = this.generation;
        // A scope taken AFTER end() and before the next begin() is dead
        // too: a transition that only reaches its jumpTo once the
        // teardown has finished (the FinishJumpEvent handler awaits a
        // date advance first) must not build a world into no session.
        const isLive = () => generation === this.generation && this.open;
        const cleanups: Array<() => void | Promise<void>> = [];
        const scope: TransitionScope = {
            generation,
            get live() {
                return isLive();
            },
            onFailure: cleanup => {
                cleanups.push(cleanup);
            },
            check: () => {
                if (!isLive()) {
                    throw new SessionEndedError();
                }
            },
            race: <T>(promise: Promise<T>,
                bound?: { timeoutMs: number, what: string }) => {
                if (!isLive()) {
                    return Promise.reject(new SessionEndedError());
                }
                return new Promise<T>((resolve, reject) => {
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    const onEnd = () => {
                        if (timer !== undefined) {
                            clearTimeout(timer);
                        }
                        reject(new SessionEndedError());
                    };
                    const done = () => {
                        this.endListeners.delete(onEnd);
                        if (timer !== undefined) {
                            clearTimeout(timer);
                        }
                    };
                    this.endListeners.add(onEnd);
                    if (bound) {
                        timer = setTimeout(() => {
                            this.endListeners.delete(onEnd);
                            reject(new TransitionTimeoutError(
                                bound.what, bound.timeoutMs));
                        }, bound.timeoutMs);
                    }
                    promise.then(value => {
                        done();
                        resolve(value);
                    }, error => {
                        done();
                        reject(error);
                    });
                });
            },
        };
        return { scope, cleanups };
    }

    /**
     * Runs `transition` under a scope of the current generation, tracked
     * so that `end()` can wait for it — cleanups included. The
     * transition's own outcome is passed straight through; on rejection
     * its registered `onFailure` cleanups run first.
     */
    async run<T>(transition: (scope: TransitionScope) => Promise<T>):
        Promise<T> {
        const { scope, cleanups } = this.scopeWithCleanups();
        const wrapped = (async () => {
            try {
                return await transition(scope);
            } catch (e) {
                for (const cleanup of cleanups.reverse()) {
                    try {
                        await cleanup();
                    } catch (cleanupError) {
                        console.warn('Transition cleanup failed:',
                            cleanupError);
                    }
                }
                throw e;
            }
        })();
        this.inFlight.add(wrapped);
        try {
            return await wrapped;
        } finally {
            this.inFlight.delete(wrapped);
        }
    }
}

/**
 * Whether an error means "the session is gone": a transition that sees
 * one must clean up after itself and NOT try to recover the ship into a
 * world that no longer exists.
 */
export function isSessionEnded(error: unknown): boolean {
    return error instanceof SessionEndedError;
}
