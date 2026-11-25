import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { beginPixiTextEntry, isReturnPress } from '../input_focus.js';
import {
    ALERT_LABEL_FONT, AquaButton, PromptField, SELECTION_COLOR,
    SELECTION_INSET, SELECTION_INSET_LEFT,
} from './alert_prompt.js';
import { MenuControls } from './menu_controls.js';

// The original's bulk quantity dialog is a NATIVE macOS (Aqua) dialog,
// not one of the game's PICT frames, so it's drawn with Graphics: a
// plain white panel with no frame, "Enter quantity:" in the system font,
// a white entry field with a 1 px black edge whose contents open
// selected (the system's light-blue highlight, so typing replaces them),
// a white rounded Cancel and the blue default button (alert_prompt.ts's
// AquaButton, as the Find and ship name prompts draw them). Every
// rectangle is sampled off trade_center/buy_quantity.png (1920x1080):
// the panel, centred on the screen, is x874..1045, y504..575 (172x72);
// the field's edge x983..1039, y509..530 (57x22), its highlight
// x987..1036, y512..527; Cancel x884..953 and the default button
// x966..1035, both y546..566 (70x21). The label's and the digits' ink
// share one baseline (y524, caps from y515), the label's starting at
// x881, the digits' at x988.
/** The panel, and everything below from its top left. */
const PANEL_WIDTH = 172;
const PANEL_HEIGHT = 72;
const FIELD_X = 109;
const FIELD_Y = 5;
const FIELD_WIDTH = 57;
const FIELD_HEIGHT = 22;
/**
 * The text boxes' left edges: the face's side bearing puts the ink one
 * pixel further in (the label's at 7 px, the digits' 5 px inside the
 * field's edge).
 */
const FIELD_TEXT_INSET_X = 4;
const LABEL_X = 6;
/**
 * The label's and the digits' text box top: both are the same face and
 * size and share a baseline in the original (caps y515..524, 11 px below
 * the panel's top).
 */
const TEXT_Y = 8;
const CANCEL_X = 10;
const CONFIRM_X = 92;
const BUTTON_Y = 42;
const BUTTON_WIDTH = 70;
const BUTTON_HEIGHT = 21;

/** Longest quantity the field accepts (999,999,999 is beyond any cap). */
const MAX_DIGITS = 9;

/**
 * Applies one typed key to the quantity field's text. Returns the new
 * text for digit and Backspace keys, or undefined for keys the field
 * ignores (letters, arrows... — those cancel/confirm elsewhere or do
 * nothing). Pure, for tests.
 */
export function editQuantityText(current: string,
    key: string): string | undefined {
    if (/^[0-9]$/.test(key)) {
        if (current.length >= MAX_DIGITS) {
            return current;
        }
        // No leading zeros ("0" then "5" becomes "5").
        return current === '0' ? key : current + key;
    }
    if (key === 'Backspace') {
        return current.slice(0, -1);
    }
    return undefined;
}

/**
 * Applies one key press to the quantity field, which opens with all of
 * its text selected, as the native field does. Returns the new field, or
 * undefined for keys the field ignores.
 *
 *  - a digit replaces the selection or is appended ({@link
 *    editQuantityText});
 *  - Backspace / Delete clears the selection; otherwise Backspace
 *    deletes the last digit (the caret is always at the end, so Delete
 *    has nothing after it);
 *  - the arrows, Home and End drop the selection;
 *  - Command-A / Control-A selects everything; any other Command /
 *    Control chord does nothing.
 *
 * Pure, for tests.
 */
export function editQuantityField(field: PromptField, key: string,
    modifiers: { meta?: boolean, ctrl?: boolean } = {}):
    PromptField | undefined {
    if (modifiers.meta || modifiers.ctrl) {
        return key.toLowerCase() === 'a'
            ? { text: field.text, selected: field.text !== '' } : undefined;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home',
        'End'].includes(key)) {
        return { text: field.text, selected: false };
    }
    if (key === 'Delete') {
        return field.selected ? { text: '', selected: false } : undefined;
    }
    const edited = editQuantityText(field.selected ? '' : field.text, key);
    return edited === undefined
        ? undefined : { text: edited, selected: false };
}

/**
 * The quantity a field's text stands for, clamped into [0, max] — the
 * "clamp to the most allowed" rule for over-entered amounts. Empty
 * text is 0. Pure, for tests.
 */
export function clampQuantity(text: string, max: number): number {
    const value = text === '' ? 0 : parseInt(text, 10);
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.min(value, Math.max(0, max));
}

export interface QuantityRequest {
    /** The confirm button's caption: 'Buy', 'Sell', 'Bet'... */
    verb: string;
    /** What the field starts out showing (already clamped by caller). */
    initial: number;
    /** The most the player may enter; larger entries clamp to this. */
    max: number;
}

/**
 * The option-click bulk quantity dialog: "Enter quantity:", a numeric
 * field (opening with the caller's prefill selected), Cancel and a verb
 * button. Resolves with the (clamped) quantity, or undefined on cancel.
 *
 * Focus discipline: while shown, its MenuControls sits on top of the
 * focus stack, so the owning screen's navigation keys (and every other
 * menu's) stay quiet. Digits, Backspace, and Enter arrive through a
 * raw keydown listener; Escape and 'd' cancel via the depart action.
 */
export class QuantityDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private result = new Subject<number | undefined>();
    private valueText = new PIXI.Text('', ALERT_LABEL_FONT);
    private selection = new PIXI.Graphics();
    private caret = new PIXI.Graphics();
    private confirmButton: AquaButton;
    private field: PromptField = { text: '', selected: false };
    private max = 0;
    private keyListener = (event: KeyboardEvent) => this.onKey(event);

    constructor(controlEvents: Observable<ControlEvent>) {
        this.container.name = 'QuantityDialog';
        this.container.visible = false;

        // A modal shield: swallows pointer events so the screen behind
        // the dialog can't be clicked while it's up.
        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001)
            .drawRect(-2000, -2000, 4000, 4000)
            .endFill();
        shield.interactive = true;
        this.container.addChild(shield);

        // Whole pixels (172 and 72 halve evenly), so the 1 px edges stay
        // crisp.
        const left = -PANEL_WIDTH / 2;
        const top = -PANEL_HEIGHT / 2;
        const fieldLeft = left + FIELD_X;
        const fieldTop = top + FIELD_Y;
        const panel = new PIXI.Graphics()
            // The panel: plain white, no frame or shadow.
            .beginFill(0xffffff)
            .drawRect(left, top, PANEL_WIDTH, PANEL_HEIGHT)
            .endFill()
            // The entry field: white with a 1 px black edge.
            .lineStyle(1, 0x000000)
            .drawRect(fieldLeft + 0.5, fieldTop + 0.5, FIELD_WIDTH - 1,
                FIELD_HEIGHT - 1);
        panel.interactive = true;
        this.container.addChild(panel);

        const label = new PIXI.Text('Enter quantity:', ALERT_LABEL_FONT);
        label.position.set(left + LABEL_X, top + TEXT_Y);
        this.container.addChild(label);

        this.selection.beginFill(SELECTION_COLOR)
            .drawRect(fieldLeft + SELECTION_INSET_LEFT,
                fieldTop + SELECTION_INSET,
                FIELD_WIDTH - SELECTION_INSET_LEFT - SELECTION_INSET,
                FIELD_HEIGHT - 2 * SELECTION_INSET)
            .endFill();
        this.container.addChild(this.selection);

        this.valueText.position.set(fieldLeft + FIELD_TEXT_INSET_X,
            top + TEXT_Y);
        this.container.addChild(this.valueText);

        this.caret.beginFill(0x000000)
            .drawRect(0, 0, 1, FIELD_HEIGHT - 2 * SELECTION_INSET - 2)
            .endFill();
        this.caret.position.y = fieldTop + SELECTION_INSET + 1;
        this.container.addChild(this.caret);

        const cancel = new AquaButton('Cancel', left + CANCEL_X,
            top + BUTTON_Y, BUTTON_WIDTH, BUTTON_HEIGHT, false,
            () => this.close(undefined));
        this.confirmButton = new AquaButton('OK', left + CONFIRM_X,
            top + BUTTON_Y, BUTTON_WIDTH, BUTTON_HEIGHT, true,
            () => this.confirm());
        this.container.addChild(cancel.container,
            this.confirmButton.container);

        this.controls = new MenuControls(controlEvents, {
            depart: () => this.close(undefined),
        });
    }

    /** The field as it stands, for headless driving and specs. */
    get value(): PromptField {
        return { ...this.field };
    }

    private onKey(event: KeyboardEvent) {
        if (!this.container.visible) {
            return;
        }
        if (isReturnPress(event)) {
            this.confirm();
            return;
        }
        // Handled here rather than via the MenuControls 'depart' binding:
        // while this field owns the keyboard the control relay is muted
        // (input_focus), so no control events arrive.
        if (event.key === 'Escape') {
            this.close(undefined);
            return;
        }
        const edited = editQuantityField(this.field, event.key,
            { meta: event.metaKey, ctrl: event.ctrlKey });
        if (edited !== undefined) {
            // Command-A selects the field, not the page.
            event.preventDefault();
            this.setField(edited);
        }
    }

    /** Live-clamps the field: entering more than allowed shows the max. */
    private setField(field: PromptField) {
        const text = field.text === ''
            ? '' : `${clampQuantity(field.text, this.max)}`;
        this.field = { text, selected: field.selected && text !== '' };
        this.valueText.text = text;
        this.selection.visible = this.field.selected;
        this.caret.visible = !this.field.selected;
        this.caret.position.x = Math.min(
            this.valueText.position.x + this.valueText.width,
            -PANEL_WIDTH / 2 + FIELD_X + FIELD_WIDTH - 3);
    }

    /** The default button (and Return): answers with the clamped field. */
    confirm() {
        this.close(clampQuantity(this.field.text, this.max));
    }

    /** Answers as the Cancel button would (headless driving). */
    cancel() {
        this.close(undefined);
    }

    private close(value: number | undefined) {
        this.result.next(value);
    }

    /**
     * Shows the dialog and resolves with the entered quantity (clamped
     * into [0, max]), or undefined if cancelled.
     */
    async show(request: QuantityRequest): Promise<number | undefined> {
        this.max = Math.max(0, Math.floor(request.max));
        this.confirmButton.setLabel(request.verb);
        // The prefill opens selected, so the first digit typed replaces
        // it (trade_center/buy_quantity.png).
        this.setField({
            text: `${Math.max(0, Math.floor(request.initial))}`,
            selected: true,
        });
        this.container.visible = true;
        this.controls.bind();
        // The quantity field owns the keyboard: without this, typed digits
        // (and Enter) would also reach the game's control relay as hotkeys.
        const releaseTextEntry = beginPixiTextEntry();
        // Headless (specs, under node) there is no document: the dialog is
        // answered through confirm() / cancel() instead.
        const target = typeof document !== 'undefined' ? document : undefined;
        target?.addEventListener('keydown', this.keyListener);
        try {
            return await firstValueFrom(this.result);
        } finally {
            target?.removeEventListener('keydown', this.keyListener);
            releaseTextEntry();
            this.controls.unbind();
            this.container.visible = false;
        }
    }
}
