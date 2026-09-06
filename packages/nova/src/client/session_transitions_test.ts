import 'jasmine';
import {
    isSessionEnded, SessionEndedError, SessionTransitions,
    TransitionTimeoutError,
} from './session_transitions.js';

/**
 * Exit-to-title versus a transition still in flight (issue #30): the
 * session generation is what makes the transition bail out instead of
 * finishing on top of the torn-down session.
 */
describe('session transitions', () => {
    let sessions: SessionTransitions;

    beforeEach(() => {
        sessions = new SessionTransitions();
        sessions.begin();
    });

    it('a scope stays live for as long as its session is open', () => {
        const scope = sessions.scope();
        expect(scope.live).toBeTrue();
        expect(() => scope.check()).not.toThrow();
    });

    it('ending the session kills every scope of it at once', () => {
        const a = sessions.scope();
        const b = sessions.scope();
        void sessions.end();
        expect(a.live).toBeFalse();
        expect(b.live).toBeFalse();
        expect(() => a.check()).toThrowError(SessionEndedError);
        expect(isSessionEnded((() => {
            try { b.check(); } catch (e) { return e; }
            return undefined;
        })())).toBeTrue();
    });

    it('a scope taken between end() and the next begin() is dead: a jump '
        + 'that reaches its transition only after the teardown must not '
        + 'build a world into no session', () => {
            void sessions.end();
            const late = sessions.scope();
            expect(late.live).toBeFalse();
            expect(() => late.check()).toThrowError(SessionEndedError);
        });

    it('a scope from a previous session is dead in the next one', () => {
        const stale = sessions.scope();
        void sessions.end();
        sessions.begin();
        expect(stale.live).toBeFalse();
        expect(sessions.scope().live).toBeTrue();
    });

    it('a transition that checks after each await bails out once the '
        + 'session has ended, and end() waits for it to do so', async () => {
            const steps: string[] = [];
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const transition = sessions.run(async scope => {
                steps.push('start');
                await gate;
                scope.check();
                steps.push('built a world'); // Must never happen.
            }).catch(e => { steps.push(e.name); });
            expect(sessions.inFlightCount).toBe(1);
            const ended = sessions.end();
            let settled = false;
            void ended.then(() => { settled = true; });
            await Promise.resolve();
            expect(settled).toBeFalse(); // Still waiting on the transition.
            release();
            await transition;
            await ended;
            expect(settled).toBeTrue();
            expect(steps).toEqual(['start', 'SessionEndedError']);
            expect(sessions.inFlightCount).toBe(0);
        });

    it('runs the onFailure cleanups (a Worker to terminate, issue #67) '
        + 'when the transition rejects, in reverse order, and end() waits '
        + 'for them too', async () => {
            const steps: string[] = [];
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const transition = sessions.run(async scope => {
                scope.onFailure(() => { steps.push('unsubscribe'); });
                scope.onFailure(async () => {
                    await gate;
                    steps.push('terminate worker');
                });
                throw new Error('init failed');
            }).catch(e => { steps.push(e.message); });
            const ended = sessions.end();
            let settled = false;
            void ended.then(() => { settled = true; });
            await Promise.resolve();
            await Promise.resolve();
            expect(settled).toBeFalse(); // The cleanup is still running.
            release();
            await transition;
            await ended;
            expect(steps).toEqual(
                ['terminate worker', 'unsubscribe', 'init failed']);
        });

    it('skips the cleanups when the transition completes', async () => {
        let ran = false;
        await sessions.run(async scope => {
            scope.onFailure(() => { ran = true; });
        });
        expect(ran).toBeFalse();
    });

    it('a cleanup that throws is logged and the rest still run', async () => {
        const warn = spyOn(console, 'warn');
        const ran: string[] = [];
        await sessions.run(async scope => {
            scope.onFailure(() => { ran.push('first'); });
            scope.onFailure(() => { throw new Error('boom'); });
            throw new Error('failed');
        }).catch(() => { /* observed */ });
        expect(ran).toEqual(['first']);
        expect(warn).toHaveBeenCalled();
    });

    it('end() never rejects, whatever the transitions threw', async () => {
        void sessions.run(async () => {
            throw new Error('worker init failed');
        }).catch(() => { /* observed */ });
        await expectAsync(sessions.end()).toBeResolved();
    });

    describe('race()', () => {
        it('passes a promise through when the session stays open',
            async () => {
                const scope = sessions.scope();
                await expectAsync(scope.race(Promise.resolve(7)))
                    .toBeResolvedTo(7);
                await expectAsync(scope.race(Promise.reject(new Error('x'))))
                    .toBeRejectedWithError('x');
            });

        it('rejects a wait that never settles the moment the session ends',
            async () => {
                const scope = sessions.scope();
                const forever = new Promise<never>(() => { });
                const wait = scope.race(forever);
                void sessions.end();
                await expectAsync(wait).toBeRejectedWithError(SessionEndedError);
            });

        it('rejects at once when the scope is already dead', async () => {
            const scope = sessions.scope();
            void sessions.end();
            await expectAsync(scope.race(Promise.resolve(1)))
                .toBeRejectedWithError(SessionEndedError);
        });

        it('times out a bounded wait (the server-peer wait, issue #72)',
            async () => {
                jasmine.clock().install();
                try {
                    const scope = sessions.scope();
                    const forever = new Promise<never>(() => { });
                    const wait = scope.race(forever,
                        { timeoutMs: 1000, what: 'the server peer' });
                    let error: unknown;
                    wait.catch(e => { error = e; });
                    jasmine.clock().tick(999);
                    await Promise.resolve();
                    expect(error).toBeUndefined();
                    jasmine.clock().tick(1);
                    await Promise.resolve();
                    expect(error).toBeInstanceOf(TransitionTimeoutError);
                    expect(String(error)).toContain('the server peer');
                } finally {
                    jasmine.clock().uninstall();
                }
            });

        it('a bounded wait that settles in time clears its timer',
            async () => {
                jasmine.clock().install();
                try {
                    const scope = sessions.scope();
                    const value = await scope.race(Promise.resolve('ok'),
                        { timeoutMs: 1000, what: 'nothing' });
                    expect(value).toBe('ok');
                    jasmine.clock().tick(2000); // No stray rejection.
                } finally {
                    jasmine.clock().uninstall();
                }
            });
    });
});
