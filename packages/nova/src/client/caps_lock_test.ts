import 'jasmine';
import { CapsLockTracker, VisibilityDocumentTarget } from './caps_lock.js';

function modifierEvent(type: string, capsLock: boolean): Event {
    const event = new Event(type);
    (event as unknown as { getModifierState: (k: string) => boolean })
        .getModifierState = (key: string) => key === 'CapsLock' && capsLock;
    return event;
}

describe('CapsLockTracker', () => {
    let win: EventTarget;
    let doc: EventTarget & { hidden: boolean };
    let tracker: CapsLockTracker;
    let dispose: () => void;

    beforeEach(() => {
        win = new EventTarget();
        doc = Object.assign(new EventTarget(), { hidden: false });
        tracker = new CapsLockTracker();
        dispose = tracker.install(win, doc as VisibilityDocumentTarget);
    });

    afterEach(() => {
        dispose();
    });

    it('reads CapsLock state from keydown/keyup and notifies only on change', () => {
        const changes: boolean[] = [];
        tracker.subscribe(active => changes.push(active));

        // Any key pressed while Caps Lock is already on detects it immediately.
        win.dispatchEvent(modifierEvent('keydown', true));
        win.dispatchEvent(modifierEvent('keyup', true));
        expect(tracker.active).toBeTrue();
        expect(changes).toEqual([true]);

        // Turning Caps Lock off notifies once.
        win.dispatchEvent(modifierEvent('keyup', false));
        expect(tracker.active).toBeFalse();
        expect(changes).toEqual([true, false]);
    });

    it('detects pre-existing CapsLock from pointer/mouse clicks before any key is pressed', () => {
        win.dispatchEvent(modifierEvent('pointerdown', true));
        expect(tracker.active).toBeTrue();
    });

    it('clears on blur and visibilitychange(hidden) and refreshes on focus + mousemove', () => {
        const changes: boolean[] = [];
        tracker.subscribe(active => changes.push(active));

        win.dispatchEvent(modifierEvent('keydown', true));
        expect(tracker.active).toBeTrue();

        // Losing window focus drops the vote so an unfocused tab cannot hold 2x.
        win.dispatchEvent(new Event('blur'));
        expect(tracker.active).toBeFalse();

        // Returning focus refreshes on the first mousemove.
        win.dispatchEvent(new Event('focus'));
        win.dispatchEvent(modifierEvent('mousemove', true));
        expect(tracker.active).toBeTrue();

        // Subsequent mousemoves while focused do not re-poll (no-op).
        win.dispatchEvent(modifierEvent('mousemove', false));
        expect(tracker.active).toBeTrue();

        // Hiding the tab clears the vote; becoming visible arms a mousemove refresh.
        doc.hidden = true;
        doc.dispatchEvent(new Event('visibilitychange'));
        expect(tracker.active).toBeFalse();

        doc.hidden = false;
        doc.dispatchEvent(new Event('visibilitychange'));
        win.dispatchEvent(modifierEvent('mousemove', true));
        expect(tracker.active).toBeTrue();
        expect(changes).toEqual([true, false, true, false, true]);
    });

    it('removes all listeners on dispose', () => {
        dispose();
        win.dispatchEvent(modifierEvent('keydown', true));
        expect(tracker.active).toBeFalse();
    });
});
