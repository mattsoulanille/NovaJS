import 'jasmine';
import { Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/controls_plugin.js';
import { MenuControls } from './menu_controls.js';

describe('MenuControls focus stack', () => {
    let events: Subject<ControlEvent>;
    let bound: MenuControls[];

    function makeControls(calls: string[], name: string,
        actions: ('buy' | 'depart' | 'up' | 'bar')[]) {
        const controls = new MenuControls(events, Object.fromEntries(
            actions.map(action => [action, () => calls.push(`${name}:${action}`)])));
        bound.push(controls);
        return controls;
    }

    function press(action: ControlEvent['action'],
        state: ControlEvent['state'] = 'start') {
        events.next({ action, state });
    }

    beforeEach(() => {
        events = new Subject();
        bound = [];
    });

    afterEach(() => {
        // The stack is global state; leave it empty for other specs.
        for (const controls of bound) {
            controls.unbind();
        }
        expect(MenuControls.focused).toBeUndefined();
    });

    it('delivers actions to the topmost bound surface only', () => {
        const calls: string[] = [];
        const spaceport = makeControls(calls, 'spaceport', ['bar', 'depart']);
        const outfitter = makeControls(calls, 'outfitter', ['buy', 'depart']);
        spaceport.bind();
        outfitter.bind();

        press('buy');
        // Modal: an action the focused surface doesn't handle does NOT
        // fall through to the surface underneath.
        press('bar');
        press('depart');
        expect(calls).toEqual(['outfitter:buy', 'outfitter:depart']);
    });

    it('returns focus to the surface underneath on unbind', () => {
        const calls: string[] = [];
        const spaceport = makeControls(calls, 'spaceport', ['depart']);
        const dialog = makeControls(calls, 'dialog', ['depart']);
        spaceport.bind();
        dialog.bind();
        expect(MenuControls.focused).toBe(dialog);

        press('depart');
        dialog.unbind();
        expect(MenuControls.focused).toBe(spaceport);
        press('depart');
        expect(calls).toEqual(['dialog:depart', 'spaceport:depart']);
    });

    it('suppresses every action of an unfocused surface (dialog focus discipline)', () => {
        const calls: string[] = [];
        const outfitter = makeControls(calls, 'outfitter',
            ['buy', 'up', 'depart']);
        const quantityDialog = makeControls(calls, 'dialog', ['depart']);
        outfitter.bind();
        quantityDialog.bind();

        // Navigation keys must not reach the outfitter while the
        // quantity dialog is up.
        press('buy');
        press('up');
        press('depart'); // Cancels the dialog, not the outfitter.
        expect(calls).toEqual(['dialog:depart']);
    });

    it('moves a re-bound surface to the top of the stack', () => {
        const calls: string[] = [];
        const a = makeControls(calls, 'a', ['depart']);
        const b = makeControls(calls, 'b', ['depart']);
        a.bind();
        b.bind();
        a.bind();
        press('depart');
        expect(calls).toEqual(['a:depart']);
    });

    it('ignores key releases', () => {
        const calls: string[] = [];
        const controls = makeControls(calls, 'a', ['buy']);
        controls.bind();
        press('buy', false);
        expect(calls).toEqual([]);
    });

    it('repeats arrows but not one-shot actions while a key is held', () => {
        const calls: string[] = [];
        const controls = makeControls(calls, 'a', ['buy', 'up']);
        controls.bind();
        press('up', 'start');
        press('up', 'repeat');
        press('buy', 'start');
        press('buy', 'repeat'); // Held 'b' must not buy again.
        expect(calls).toEqual(['a:up', 'a:up', 'a:buy']);
    });

    it('repeats an action a surface opts into (outfitter buy/sell)', () => {
        const calls: string[] = [];
        const controls = makeControls(calls, 'a', ['buy', 'up']);
        // The outfitter opts buy (and sell) into key-repeat.
        controls.repeatableActions.add('buy');
        controls.bind();
        press('buy', 'start');
        press('buy', 'repeat'); // Now honored: held 'b' buys again.
        press('up', 'repeat');
        expect(calls).toEqual(['a:buy', 'a:buy', 'a:up']);
    });

    it('scopes opted-in repeats to the surface that added them', () => {
        const calls: string[] = [];
        const outfitter = makeControls(calls, 'outfitter', ['buy']);
        outfitter.repeatableActions.add('buy');
        const other = makeControls(calls, 'other', ['buy']);
        // A different surface never gained buy-repeat.
        expect(other.repeatableActions.has('buy')).toBe(false);
    });

    it('reports no focus once everything is unbound', () => {
        const controls = makeControls([], 'a', ['buy']);
        controls.bind();
        expect(MenuControls.focused).toBe(controls);
        controls.unbind();
        expect(MenuControls.focused).toBeUndefined();
    });
});
