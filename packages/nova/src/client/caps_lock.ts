/**
 * Tracks the real Caps Lock key state from browser modifier events
 * (`KeyboardEvent.getModifierState('CapsLock')` and `MouseEvent` /
 * `PointerEvent.getModifierState('CapsLock')`), plus focus and visibility
 * changes (#371).
 *
 * Installed at page startup (browser.ts) so a player who already has Caps
 * Lock on when they click "Enter Ship" or press Enter on the title screen
 * votes yes from the very first room they enter.
 *
 * Pure DOM-event logic over injectable `EventTarget`s so unit specs drive
 * it directly under Node with no browser.
 */

export interface ModifierStateEvent {
    getModifierState?(keyArg: string): boolean;
}

export interface VisibilityDocumentTarget extends EventTarget {
    readonly hidden?: boolean;
}

export class CapsLockTracker {
    private _active = false;
    private readonly listeners = new Set<(active: boolean) => void>();
    /**
     * Armed on blur, focus, or visibilitychange so the very next mouse
     * movement after returning to the window refreshes the modifier state
     * even before the user clicks or presses a key.
     */
    private awaitingFocusRefresh = false;

    get active(): boolean {
        return this._active;
    }

    /** Subscribes to changes in the tracked Caps Lock state. */
    subscribe(listener: (active: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Reads `getModifierState('CapsLock')` from a keyboard/pointer/mouse event. */
    observe(event: ModifierStateEvent): void {
        if (typeof event.getModifierState !== 'function') {
            return;
        }
        this.setActive(Boolean(event.getModifierState('CapsLock')));
    }

    private setActive(next: boolean): void {
        if (next === this._active) {
            return;
        }
        this._active = next;
        for (const listener of this.listeners) {
            try {
                listener(next);
            } catch (e) {
                console.warn('CapsLock listener failed:', e);
            }
        }
    }

    /**
     * Attaches window and document listeners and returns the disposer.
     *
     * - `keydown`, `keyup`, `pointerdown`, `mousedown` (capture phase):
     *   read the real Caps Lock state immediately on every interaction.
     * - `blur` / `visibilitychange` (hidden): clear the vote to `false`
     *   so an unfocused or backgrounded tab cannot hold a room at 2x (nor
     *   stay stale if the user toggles Caps Lock in another app), and arm
     *   a one-shot `mousemove` refresh for when the user returns.
     * - `focus` / `visibilitychange` (visible): arm the one-shot
     *   `mousemove` refresh so moving the pointer back into the game
     *   re-reads Caps Lock immediately.
     */
    install(win: EventTarget, doc: VisibilityDocumentTarget): () => void {
        const onModifierEvent = (event: Event) => {
            this.awaitingFocusRefresh = false;
            this.observe(event as unknown as ModifierStateEvent);
        };
        const onMouseMove = (event: Event) => {
            if (!this.awaitingFocusRefresh) {
                return;
            }
            this.awaitingFocusRefresh = false;
            this.observe(event as unknown as ModifierStateEvent);
        };
        const onBlur = () => {
            this.awaitingFocusRefresh = true;
            this.setActive(false);
        };
        const onFocus = () => {
            this.awaitingFocusRefresh = true;
        };
        const onVisibilityChange = () => {
            this.awaitingFocusRefresh = true;
            if (doc.hidden) {
                this.setActive(false);
            }
        };

        const capture = { capture: true };
        win.addEventListener('keydown', onModifierEvent, capture);
        win.addEventListener('keyup', onModifierEvent, capture);
        win.addEventListener('pointerdown', onModifierEvent, capture);
        win.addEventListener('mousedown', onModifierEvent, capture);
        win.addEventListener('mousemove', onMouseMove, capture);
        win.addEventListener('blur', onBlur);
        win.addEventListener('focus', onFocus);
        doc.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            win.removeEventListener('keydown', onModifierEvent, capture);
            win.removeEventListener('keyup', onModifierEvent, capture);
            win.removeEventListener('pointerdown', onModifierEvent, capture);
            win.removeEventListener('mousedown', onModifierEvent, capture);
            win.removeEventListener('mousemove', onMouseMove, capture);
            win.removeEventListener('blur', onBlur);
            win.removeEventListener('focus', onFocus);
            doc.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }
}
