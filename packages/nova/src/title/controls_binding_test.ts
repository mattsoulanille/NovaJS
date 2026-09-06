import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import {
    Controls, getActions, SavedControls,
} from '../nova_plugin/core/controls.js';
import {
    bindControl, ControlsOverride, mergeControls, primaryBinding,
} from './client_prefs.js';

/**
 * The editor -> live-controls path, end to end at the layer it lives in:
 * an override map goes through mergeControls + the Controls codec, and
 * the result is queried with the same getActions the key handler uses.
 *
 * The bug this pins: `getActions` returns EVERY action bound to a code,
 * so binding an action onto an occupied key used to leave both firing,
 * which is what made rebindings look like they "did not take effect".
 */

/** A representative slice of the served controls.json. */
const BASE: Record<string, unknown> = {
    accelerate: 'ArrowUp',
    turnLeft: 'ArrowLeft',
    turnRight: 'ArrowRight',
    hyperjump: 'KeyJ',
    nextSecondary: 'KeyW',
    fireSecondary: ['ControlLeft', 'ShiftLeft'],
    // Modifier-gated bindings, verbatim from controls.json. getActions
    // only fires these when every modifier is held, so a BARE bind of the
    // same code is not a collision and must not disturb them.
    selfDestruct: { key: 'Minus', modifiers: ['Alt', 'Shift'] },
    previousSecondary: { key: 'KeyW', modifiers: ['Alt'] },
    nextTarget: { key: 'Tab' },
    // Not in controls.json, but a plugin's controls.json can say this: one
    // action owning a bare key AND a modifier-gated key. Stealing the bare
    // one must leave the modifier-gated one bound.
    mixedBinding: ['KeyQ', { key: 'KeyP', modifiers: ['Alt'] }],
    // A menu action deliberately sharing a key with a flight control:
    // these live in different contexts and must NOT be displaced.
    up: 'ArrowUp',
};

/**
 * The actions the preferences editor exposes for rebinding.
 *
 * `previousSecondary` / `mixedBinding` are not on the editor's tabs today;
 * they are listed here so the modifier rule is pinned for whatever the
 * editor exposes next, rather than only for the actions it happens to
 * expose right now.
 */
const REBINDABLE = ['accelerate', 'turnLeft', 'turnRight', 'hyperjump',
    'nextSecondary', 'fireSecondary', 'selfDestruct', 'previousSecondary',
    'nextTarget', 'mixedBinding'];

function live(override: ControlsOverride): Controls {
    const decoded = SavedControls.pipe(Controls)
        .decode(mergeControls(BASE, override));
    if (isLeft(decoded)) {
        throw new Error('controls failed to decode');
    }
    return decoded.right;
}

/** getActions only reads `code` and modifier state. */
function press(controls: Controls, code: string): string[] {
    return pressWith(controls, code, []);
}

/** Presses `code` with exactly `held` modifiers down. */
function pressWith(controls: Controls, code: string,
    held: readonly string[]): string[] {
    return getActions(controls, {
        code,
        getModifierState: (m: string) => held.includes(m),
    } as unknown as KeyboardEvent);
}

describe('control rebinding', () => {
    describe('primaryBinding', () => {
        it('reads the served default', () => {
            expect(primaryBinding('accelerate', BASE, {})).toBe('ArrowUp');
        });

        it('reads the first key of a multi-key default', () => {
            expect(primaryBinding('fireSecondary', BASE, {}))
                .toBe('ControlLeft');
        });

        it('prefers an override', () => {
            expect(primaryBinding('accelerate', BASE, { accelerate: 'KeyZ' }))
                .toBe('KeyZ');
        });

        it('reports an explicitly unbound action as empty', () => {
            expect(primaryBinding('accelerate', BASE, { accelerate: '' }))
                .toBe('');
        });

        it('is empty for an action with no binding at all', () => {
            expect(primaryBinding('nothing', BASE, {})).toBe('');
        });
    });

    describe('bindControl displacement', () => {
        it('takes the key from the rebindable action that had it', () => {
            const next = bindControl(BASE, {}, 'fireSecondary', 'KeyJ',
                REBINDABLE);
            expect(next['fireSecondary']).toBe('KeyJ');
            // hyperjump owned KeyJ and must give it up.
            expect(next['hyperjump']).toBe('');
        });

        it('leaves context-scoped actions alone', () => {
            // 'up' is a menu action sharing ArrowUp with accelerate; it is
            // not in the editor, so it keeps its key.
            const next = bindControl(BASE, {}, 'turnLeft', 'ArrowUp',
                REBINDABLE);
            expect(next['turnLeft']).toBe('ArrowUp');
            expect(next['accelerate']).toBe('');
            expect(next['up']).toBeUndefined();
        });

        it('does not displace the action being bound', () => {
            const next = bindControl(BASE, {}, 'accelerate', 'ArrowUp',
                REBINDABLE);
            expect(next['accelerate']).toBe('ArrowUp');
        });

        it('does not mutate the input override', () => {
            const override: ControlsOverride = {};
            bindControl(BASE, override, 'fireSecondary', 'KeyJ', REBINDABLE);
            expect(override).toEqual({});
        });

        it('takes a multi-key action\'s SECOND key, keeping the first', () => {
            // fireSecondary owns ControlLeft AND ShiftLeft. Checking only
            // its first key left ShiftLeft owned by both actions.
            const next = bindControl(BASE, {}, 'turnLeft', 'ShiftLeft',
                REBINDABLE);
            expect(next['turnLeft']).toBe('ShiftLeft');
            expect(next['fireSecondary']).toBe('ControlLeft');
        });

        it('leaves a modifier-gated binding alone on a bare-key bind', () => {
            // selfDestruct is Alt+Shift+Minus; it never fires on bare
            // Minus, so binding bare Minus is not a collision at all.
            const next = bindControl(BASE, {}, 'turnLeft', 'Minus',
                REBINDABLE);
            expect(next['turnLeft']).toBe('Minus');
            expect(next['selfDestruct']).toBeUndefined();
        });

        it('leaves a modifier-gated sibling on the stolen code', () => {
            // nextSecondary (bare KeyW) loses the key; previousSecondary
            // (Alt+KeyW) is a different binding and keeps it.
            const next = bindControl(BASE, {}, 'turnLeft', 'KeyW',
                REBINDABLE);
            expect(next['nextSecondary']).toBe('');
            expect(next['previousSecondary']).toBeUndefined();
        });

        it('keeps an action\'s modifier key when its bare key is taken', () => {
            const next = bindControl(BASE, {}, 'turnLeft', 'KeyQ',
                REBINDABLE);
            expect(next['mixedBinding'])
                .toEqual([{ key: 'KeyP', modifiers: ['Alt'] }]);
        });

        it('unbinds an action whose only key is taken', () => {
            const next = bindControl(BASE, {}, 'turnLeft', 'Tab', REBINDABLE);
            expect(next['nextTarget']).toBe('');
        });

        it('displaces a previously-overridden action too', () => {
            const first = bindControl(BASE, {}, 'turnLeft', 'KeyG',
                REBINDABLE);
            const second = bindControl(BASE, first, 'turnRight', 'KeyG',
                REBINDABLE);
            expect(second['turnRight']).toBe('KeyG');
            expect(second['turnLeft']).toBe('');
        });
    });

    describe('editor edit -> live bindings', () => {
        it('a rebound key fires ONLY the rebound action', () => {
            const override = bindControl(BASE, {}, 'fireSecondary', 'KeyJ',
                REBINDABLE);
            const controls = live(override);
            expect(press(controls, 'KeyJ')).toEqual(['fireSecondary']);
        });

        it('the displaced action no longer fires on its old key', () => {
            const override = bindControl(BASE, {}, 'fireSecondary', 'KeyJ',
                REBINDABLE);
            const controls = live(override);
            expect(press(controls, 'KeyJ')).not.toContain('hyperjump');
        });

        it('the rebound action stops firing on its old key', () => {
            const override = bindControl(BASE, {}, 'accelerate', 'KeyZ',
                REBINDABLE);
            const controls = live(override);
            expect(press(controls, 'KeyZ')).toEqual(['accelerate']);
            expect(press(controls, 'ArrowUp')).not.toContain('accelerate');
        });

        it('keeps the menu action on a shared key after a rebind', () => {
            const override = bindControl(BASE, {}, 'turnLeft', 'ArrowUp',
                REBINDABLE);
            const controls = live(override);
            const actions = press(controls, 'ArrowUp');
            expect(actions).toContain('turnLeft');
            // The menu binding survives; the flight one was displaced.
            expect(actions).toContain('up');
            expect(actions).not.toContain('accelerate');
        });

        it('replaces a multi-key default with the single new key', () => {
            const override = bindControl(BASE, {}, 'fireSecondary', 'KeyJ',
                REBINDABLE);
            const controls = live(override);
            expect(press(controls, 'ControlLeft')).toEqual([]);
            expect(press(controls, 'ShiftLeft')).toEqual([]);
        });

        it('the 2nd key of a multi-key action fires only its new owner',
            () => {
                // The double-fire this whole feature exists to prevent:
                // ShiftLeft used to fire turnLeft AND fireSecondary.
                const controls = live(bindControl(BASE, {}, 'turnLeft',
                    'ShiftLeft', REBINDABLE));
                expect(press(controls, 'ShiftLeft')).toEqual(['turnLeft']);
                // ...and fireSecondary keeps the key that was NOT taken.
                expect(press(controls, 'ControlLeft'))
                    .toEqual(['fireSecondary']);
            });

        it('keeps self-destruct on Alt+Shift+Minus after a bare Minus bind',
            () => {
                const controls = live(bindControl(BASE, {}, 'turnLeft',
                    'Minus', REBINDABLE));
                expect(pressWith(controls, 'Minus', ['Alt', 'Shift']))
                    .toEqual(['selfDestruct']);
                // Bare Minus is the new binding only: selfDestruct's
                // modifier gate was never satisfied on a bare press.
                expect(press(controls, 'Minus')).toEqual(['turnLeft']);
            });

        it('keeps the Alt binding when its bare-key sibling is displaced',
            () => {
                const controls = live(bindControl(BASE, {}, 'turnLeft', 'KeyW',
                    REBINDABLE));
                expect(press(controls, 'KeyW')).toEqual(['turnLeft']);
                expect(pressWith(controls, 'KeyW', ['Alt']))
                    .toEqual(['previousSecondary']);
            });

        it('an untouched action keeps its served default', () => {
            const controls = live(
                bindControl(BASE, {}, 'accelerate', 'KeyZ', REBINDABLE));
            expect(press(controls, 'ArrowRight')).toContain('turnRight');
        });

        it('no overrides reproduces the served bindings exactly', () => {
            const controls = live({});
            expect(press(controls, 'ArrowUp').sort())
                .toEqual(['accelerate', 'up']);
            expect(press(controls, 'KeyJ')).toEqual(['hyperjump']);
        });
    });
});
