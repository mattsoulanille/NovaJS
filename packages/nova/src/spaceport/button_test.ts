import 'jasmine';
import { pressTransition } from './button.js';

describe('Button pressTransition', () => {
    it('presses and clicks when enabled', () => {
        const down = pressTransition('normal', undefined, 'down');
        expect(down.state).toBe('clicked');
        expect(down.pressedFrom).toBe('normal');
        const up = pressTransition('clicked', down.pressedFrom, 'up');
        expect(up.state).toBe('normal');
        expect(up.fire).toBeTrue();
    });

    it('stays grey through a click: no pressed flash, no enabled bounce, '
        + 'no click', () => {
        const down = pressTransition('grey', undefined, 'down');
        expect(down.state).toBeUndefined();
        expect(down.pressedFrom).toBeUndefined();
        const up = pressTransition('grey', down.pressedFrom, 'up');
        expect(up.state).toBeUndefined();
        expect(up.fire).toBeFalse();
    });

    it('presses THROUGH grey when the debug override asks, fires the click, '
        + 'and settles back to grey', () => {
        const down = pressTransition('grey', undefined, 'down', true);
        expect(down.state).toBe('clicked');
        expect(down.pressedFrom).toBe('grey');
        const up = pressTransition('clicked', down.pressedFrom, 'up');
        expect(up.fire).toBeTrue();
        expect(up.state).toBe('grey');
    });

    it('stays grey through a drag-off release', () => {
        const down = pressTransition('grey', undefined, 'down');
        const out = pressTransition('grey', down.pressedFrom, 'upoutside');
        expect(out.state).toBeUndefined();
        expect(out.fire).toBeFalse();
    });

    it('a drag-off release restores the pre-press state without firing',
        () => {
            const down = pressTransition('normal', undefined, 'down');
            const out = pressTransition('clicked', down.pressedFrom,
                'upoutside');
            expect(out.state).toBe('normal');
            expect(out.pressedFrom).toBeUndefined();
            expect(out.fire).toBeFalse();
        });

    it('a button greyed mid-press drags off back to grey', () => {
        // The press began enabled; the surface greyed it while held
        // (e.g. a refresh); releasing off the button restores what the
        // press started from.
        const down = pressTransition('grey', 'grey', 'upoutside');
        expect(down.state).toBe('grey');
    });
});
