import {
    ControlAction, Controls, getActions,
} from '../nova_plugin/core/index.js';

/**
 * Browser fullscreen: the `fullscreen` control action (Option+Return on a
 * Mac, Alt+Enter elsewhere; controls.json) and the Preferences > Display
 * "Fullscreen" button.
 *
 * Client-local presentation like the scale keys and the FPS meter: the
 * simulation never sees the action (game_session.ts drops it), so peers
 * stay in lockstep whatever any of them does with their window.
 *
 * It fullscreens the whole document, not the PIXI canvas: the title's
 * dialogs, the HTML input overlays and the touch controls are DOM
 * siblings of the canvas and would vanish behind a fullscreened canvas.
 * The layout follows on its own (the window `resize` re-runs the display
 * scale).
 *
 * Matthew 2026-11-24 moved the key off plain Return, which the original
 * uses for the default button (Leave in the spaceport, closing the
 * outfitter and the BBS; reference "The UI screen x key matrix, wave 11").
 */

/** The DOM surface fullscreen needs, so node specs can stand in for it. */
export interface FullscreenDocument {
    readonly fullscreenElement: unknown;
    readonly documentElement: {
        requestFullscreen?: () => Promise<void> | void;
    };
    exitFullscreen?: () => Promise<void> | void;
}

/** Whether the document is fullscreen now. */
export function isFullscreen(doc: FullscreenDocument = document): boolean {
    return doc.fullscreenElement != null;
}

/** Whether this browser can fullscreen an element at all (an iPhone can't). */
export function fullscreenSupported(doc: FullscreenDocument = document): boolean {
    return typeof doc.documentElement.requestFullscreen === 'function';
}

/**
 * Enters fullscreen, or leaves it when already there.
 *
 * Must run inside the input event that asked for it: browsers only grant
 * requestFullscreen to a page with user activation, so a key handler or a
 * click handler calls this directly rather than from a later frame. A
 * refusal (no activation, a sandboxed iframe, a browser without the API)
 * is logged, never thrown: fullscreen is a nicety.
 */
export function toggleFullscreen(doc: FullscreenDocument = document): void {
    const request = isFullscreen(doc)
        ? doc.exitFullscreen?.call(doc)
        : doc.documentElement.requestFullscreen?.call(doc.documentElement);
    Promise.resolve(request).catch((e: unknown) => {
        console.warn('Fullscreen request refused:', e);
    });
}

/** The KeyboardEvent surface the shortcut reads. */
export type ShortcutKeyEvent = Pick<KeyboardEvent,
    'type' | 'code' | 'repeat' | 'getModifierState' | 'preventDefault'>;

/**
 * Handles one keydown for the fullscreen shortcut: if `controls` binds it
 * to `fullscreen` (with every modifier the binding needs held), toggles
 * fullscreen and consumes the key. Key repeats are swallowed without
 * toggling, so holding the chord does not flicker. Returns whether the key
 * was the shortcut.
 */
export function handleFullscreenKey(event: ShortcutKeyEvent,
    controls: Controls | undefined,
    toggle: () => void = toggleFullscreen): boolean {
    if (event.type !== 'keydown' || !controls) {
        return false;
    }
    const actions: ControlAction[] = getActions(controls,
        event as KeyboardEvent);
    if (!actions.includes('fullscreen')) {
        return false;
    }
    event.preventDefault();
    if (!event.repeat) {
        toggle();
    }
    return true;
}

/**
 * Installs the fullscreen shortcut for the page's lifetime: on the title
 * screen, in flight, in the spaceport and over dialogs alike, with
 * whatever bindings `controls` returns at the moment of the key.
 *
 * A bubbling document listener, so a surface that owns the keyboard in
 * the capture phase (the Preferences key capture, the starmap Find field)
 * still keeps the key.
 */
export function installFullscreenShortcut(target: Document,
    controls: () => Controls | undefined): () => void {
    const onKey = (event: KeyboardEvent) => {
        handleFullscreenKey(event, controls());
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
}

/**
 * How the shortcut reads on this platform: "Option+Return" on a Mac (the
 * key caps say so), "Alt+Enter" elsewhere.
 */
export function fullscreenShortcutLabel(platform: string | undefined =
    typeof navigator !== 'undefined' ? navigator.platform : undefined): string {
    return isMacPlatform(platform) ? 'Option+Return' : 'Alt+Enter';
}

/** Mac and iPad/iPhone report "MacIntel" / "iPad" / "iPhone". */
export function isMacPlatform(platform: string | undefined): boolean {
    return /^(Mac|iPad|iPhone|iPod)/i.test(platform ?? '');
}

/** The button surface wireFullscreenButton drives (a DOM button in play). */
export interface FullscreenButton {
    textContent: string | null;
    disabled: boolean;
    title: string;
    readonly isConnected: boolean;
    addEventListener(type: 'click', listener: () => void): void;
}

/** The document surface the button needs: fullscreen plus its event. */
export type FullscreenEventDocument = FullscreenDocument & {
    addEventListener(type: 'fullscreenchange', listener: () => void): void;
    removeEventListener(type: 'fullscreenchange', listener: () => void): void;
};

/**
 * Makes `button` the Preferences "Fullscreen" button: a click toggles
 * fullscreen INSIDE the click handler (the user activation
 * requestFullscreen needs), and the label follows the document's state,
 * "Fullscreen" or "Exit Fullscreen", whoever changed it (this button, the
 * shortcut, or the browser's own Escape / F11 / Ctrl+Cmd+F). Disabled
 * where the browser cannot fullscreen an element. The state listener
 * retires itself once the button has left the page (the Preferences tabs
 * are rebuilt on every switch).
 */
export function wireFullscreenButton(button: FullscreenButton,
    doc: FullscreenEventDocument = document,
    toggle: (doc: FullscreenDocument) => void = toggleFullscreen): void {
    const render = () => {
        button.textContent = isFullscreen(doc)
            ? 'Exit Fullscreen' : 'Fullscreen';
    };
    render();
    if (!fullscreenSupported(doc)) {
        button.disabled = true;
        button.title = 'This browser cannot go fullscreen.';
        return;
    }
    const onChange = () => {
        if (!button.isConnected) {
            doc.removeEventListener('fullscreenchange', onChange);
            return;
        }
        render();
    };
    doc.addEventListener('fullscreenchange', onChange);
    button.addEventListener('click', () => toggle(doc));
}
