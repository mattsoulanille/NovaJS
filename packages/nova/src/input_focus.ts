// Tracks whether a text-entry surface currently owns the keyboard, so the
// browser's global control-event relay (browser.ts) can drop game hotkeys
// before they ever become control events. Without this, typing into a text
// field also fires document-level game controls — e.g. digits selecting
// stellar bodies, 'd' departing, 'm' opening the map — because the same
// keydown reaches both the field and the control relay.
//
// Two independent sources are tracked:
//   - PIXI text-entry modals (e.g. the starmap Find dialog) that are not real
//     DOM inputs: they register/unregister explicitly around their lifetime.
//   - Real HTML input overlays (title-screen dialogs, prompts, ...): detected
//     live from document.activeElement, so nothing has to register them.
//
// Suppression driven by this state is purely client-side and
// determinism-safe: the dropped events are never recorded as inputs, so no
// peer's simulation is affected (see novajs-determinism notes).

let pixiTextEntryCount = 0;

/**
 * Marks a PIXI text-entry modal (like the starmap Find dialog) as owning the
 * keyboard. Returns a release function; call it (idempotently) when the modal
 * closes. Reference-counted so nested/overlapping modals behave.
 */
export function beginPixiTextEntry(): () => void {
    pixiTextEntryCount++;
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        pixiTextEntryCount = Math.max(0, pixiTextEntryCount - 1);
    };
}

/** Whether the focused DOM element is an editable field. */
function domTextEntryFocused(): boolean {
    if (typeof document === 'undefined') {
        return false;
    }
    const el = document.activeElement as HTMLElement | null;
    if (!el) {
        return false;
    }
    const tag = el.tagName;
    // Any focused form control counts: a dialog's text field is the obvious
    // case, but treating a focused button/checkbox/select as keyboard-owning
    // too is correct — the player is driving that dialog, not the ship.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
    }
    return el.isContentEditable === true;
}

/**
 * True while any text-entry surface (a registered PIXI modal or a focused DOM
 * input) owns the keyboard. The control relay should generate no game control
 * events while this holds.
 */
export function isTextEntryActive(): boolean {
    return pixiTextEntryCount > 0 || domTextEntryFocused();
}

/**
 * Whether a key press is Return as a dialog's default-button key: Enter
 * WITHOUT Option/Alt. Option+Return (Alt+Enter) is the fullscreen shortcut
 * (client/fullscreen.ts), so it must not also press OK underneath.
 */
export function isReturnPress(event: { key: string, altKey?: boolean }):
    boolean {
    return event.key === 'Enter' && !event.altKey;
}
