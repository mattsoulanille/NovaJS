import * as PIXI from 'pixi.js';
import { BehaviorSubject } from 'rxjs';
import { beginPixiTextEntry } from '../input_focus.js';

/**
 * The outfitter's and shipyard's search field (a NovaJS Enhancement,
 * "Shop search"; Matthew, 2026-11-23: "Search bar (or maybe filter) for
 * outfitter + shipyard"). The original has none.
 *
 * It is drawn in the dialog's own idiom rather than as a native text box:
 * a black well with the grid's dim 1 px rule round it (item_grid.ts's
 * gridDim), the shops' Geneva 9.4 px text in white, a grey "Search"
 * placeholder, and the grid's bright red rule round it while it has the
 * keyboard. It sits in the frame's bottom strip left of the scroll arrows,
 * under the grid it filters.
 *
 * KEYBOARD. Clicking the well (or Cmd/Ctrl+F while the shop is up) gives
 * it the keyboard. While it has it, every key goes to the field and
 * nowhere else: a capture-phase window listener stops each keydown before
 * the game's control relay or the shop's own keys (b, s, d, the arrows)
 * can see it, and the field registers as a PIXI text-entry surface so the
 * relay stands down besides (input_focus.ts) — the FindDialog's two lines
 * of defence. Escape clears the query and lets go; Enter or Tab lets go
 * and keeps it; a click anywhere else lets go too. Without the keyboard
 * the field takes no keys at all, so the shop's keys work as before.
 */

/** The well, in the shop container's coordinates (see placeAt). */
export const SEARCH_FIELD_SIZE = { width: 122, height: 17 } as const;
const MAX_LENGTH = 30;
const FIELD_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff,
    align: 'left', wordWrap: false,
};
/** item_grid.ts's gridDim / gridBright (cölr is not plumbed yet). */
const RULE_DIM = 0x404040;
const RULE_FOCUSED = 0xff0000;
const PLACEHOLDER = 'Search';
/** The placeholder's grey: lighter than the tiles' (78,78,78) subtitle
 * grey, which is too dark to read on the well's black. */
const PLACEHOLDER_GREY = 0x7e7e7e;

/**
 * Applies one typed key to the query. Returns the new text, or undefined
 * for a key the field does not edit with. Pure, for tests.
 */
export function editSearchText(current: string,
    key: string): string | undefined {
    if (key === 'Backspace') {
        return current.slice(0, -1);
    }
    if (key.length === 1) {
        return current.length >= MAX_LENGTH ? current : current + key;
    }
    return undefined;
}

/** What one keydown does while the field has the keyboard. */
export type SearchKeyAction =
    | { kind: 'edit', text: string }
    | { kind: 'blur', clear: boolean }
    | { kind: 'ignore' };

/** Pure: the field's response to a key while it has the keyboard. Every
 * key is swallowed whatever the action, so none reaches the game. */
export function searchKeyAction(current: string,
    event: { key: string, metaKey?: boolean, ctrlKey?: boolean }):
    SearchKeyAction {
    if (event.key === 'Escape') {
        return { kind: 'blur', clear: true };
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
        return { kind: 'blur', clear: false };
    }
    if (event.metaKey || event.ctrlKey) {
        // Shortcuts (Cmd+R, Cmd+F...) neither type nor leave the field.
        return { kind: 'ignore' };
    }
    const text = editSearchText(current, event.key);
    return text === undefined ? { kind: 'ignore' } : { kind: 'edit', text };
}

/** Whether a keydown is the "focus the search" shortcut (Cmd/Ctrl+F). */
export function isFocusShortcut(event: { code: string, key: string,
    metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean }): boolean {
    return (event.metaKey === true || event.ctrlKey === true)
        && event.altKey !== true
        && (event.code === 'KeyF' || event.key.toLowerCase() === 'f');
}

export class ShopSearchField {
    readonly container = new PIXI.Container();
    /** The query, as typed. */
    readonly query = new BehaviorSubject<string>('');
    private readonly well = new PIXI.Graphics();
    private readonly text = new PIXI.Text('', FIELD_FONT);
    private readonly caret = new PIXI.Graphics();
    private focused = false;
    private enabled = false;
    private releaseTextEntry?: () => void;
    /** Set by the well's own pointerdown, so the page-level listener that
     * runs after it knows the click was on the field. */
    private pressedField = false;
    private readonly onKey = (event: KeyboardEvent) => this.handleKey(event);
    private readonly onShortcut = (event: KeyboardEvent) =>
        this.handleShortcut(event);
    private readonly onPagePointer = () => {
        if (!this.pressedField && this.focused) {
            this.blur(false);
        }
        this.pressedField = false;
    };

    constructor() {
        this.container.name = 'ShopSearch';
        this.container.visible = false;
        this.well.eventMode = 'static';
        this.well.cursor = 'text';
        this.well.hitArea = new PIXI.Rectangle(0, 0, SEARCH_FIELD_SIZE.width,
            SEARCH_FIELD_SIZE.height);
        this.well.on('pointerdown', () => {
            this.pressedField = true;
            this.focus();
        });
        this.text.position.set(4, 2);
        // A long query scrolls out of sight at the right edge rather than
        // spilling over the frame.
        const clip = new PIXI.Graphics()
            .beginFill(0xffffff)
            .drawRect(1, 1, SEARCH_FIELD_SIZE.width - 2,
                SEARCH_FIELD_SIZE.height - 2)
            .endFill();
        this.text.mask = clip;
        this.container.addChild(this.well, this.text, this.caret, clip);
        this.draw();
    }

    /** Puts the well's top-left corner at (x, y) in the shop's frame. */
    placeAt(x: number, y: number) {
        this.container.position.set(x, y);
    }

    /** Whether the field has the keyboard. */
    get hasFocus(): boolean {
        return this.focused;
    }

    /**
     * A shop visit starts: an empty query, and the field shown or not as
     * the "Shop search" enhancement says. Disabled, the field is gone and
     * the query stays empty, so the grid shows everything (the original).
     */
    open(enabled: boolean) {
        this.blur(true);
        this.enabled = enabled;
        this.container.visible = enabled;
        if (enabled) {
            this.installShortcut();
        } else {
            this.removeShortcut();
        }
    }

    /** The shop closes: let go of the keyboard and the shortcut. */
    close() {
        this.blur(true);
        this.removeShortcut();
        this.container.visible = false;
    }

    /** Gives the field the keyboard (a click on it, or Cmd/Ctrl+F). */
    focus() {
        if (!this.enabled || this.focused || !this.container.worldVisible) {
            return;
        }
        this.focused = true;
        this.releaseTextEntry = beginPixiTextEntry();
        if (typeof window !== 'undefined') {
            // Capture phase, ahead of the game's keyboard handling.
            window.addEventListener('keydown', this.onKey, true);
            window.addEventListener('pointerdown', this.onPagePointer);
        }
        this.draw();
    }

    /** Lets go of the keyboard, clearing the query when `clear`. */
    blur(clear: boolean) {
        if (clear && this.query.value !== '') {
            this.query.next('');
        }
        if (this.focused) {
            this.focused = false;
            this.releaseTextEntry?.();
            this.releaseTextEntry = undefined;
            if (typeof window !== 'undefined') {
                window.removeEventListener('keydown', this.onKey, true);
                window.removeEventListener('pointerdown', this.onPagePointer);
            }
        }
        this.draw();
    }

    /** Types `key` as if pressed while focused (specs, headless driving). */
    type(key: string) {
        this.apply(searchKeyAction(this.query.value, { key }));
    }

    private handleKey(event: KeyboardEvent) {
        if (!this.container.worldVisible) {
            // The shop went away under us (a world teardown): let go
            // rather than eat the next system's keys.
            this.blur(true);
            return;
        }
        event.stopImmediatePropagation();
        event.preventDefault();
        this.apply(searchKeyAction(this.query.value, event));
    }

    private apply(action: SearchKeyAction) {
        if (action.kind === 'edit') {
            this.query.next(action.text);
            this.draw();
        } else if (action.kind === 'blur') {
            this.blur(action.clear);
        }
    }

    private handleShortcut(event: KeyboardEvent) {
        if (this.focused || !this.container.worldVisible
            || !isFocusShortcut(event)) {
            return;
        }
        event.stopImmediatePropagation();
        event.preventDefault();
        this.focus();
    }

    private installShortcut() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', this.onShortcut, true);
            window.addEventListener('keydown', this.onShortcut, true);
        }
    }

    private removeShortcut() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', this.onShortcut, true);
        }
    }

    private draw() {
        const { width, height } = SEARCH_FIELD_SIZE;
        this.well.clear()
            .lineStyle(1, this.focused ? RULE_FOCUSED : RULE_DIM, 1, 0)
            .beginFill(0x000000)
            .drawRect(0, 0, width, height)
            .endFill();
        const value = this.query.value;
        this.text.text = value || (this.focused ? '' : PLACEHOLDER);
        this.text.style.fill = value ? 0xffffff : PLACEHOLDER_GREY;
        // Keep the end of a long query (and the caret) in view.
        const room = SEARCH_FIELD_SIZE.width - 10;
        const textWidth = value ? this.text.width : 0;
        this.text.position.x = 4 - Math.max(0, textWidth - room);
        this.caret.clear();
        if (this.focused) {
            const x = this.text.position.x + textWidth + 1;
            this.caret.lineStyle(1, 0xffffff, 1, 0)
                .moveTo(x, 3).lineTo(x, height - 3);
        }
    }
}
