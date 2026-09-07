import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { beginPixiTextEntry } from '../input_focus.js';
import { MenuControls } from './menu_controls.js';

// The plain system dialog from the reference screenshots
// (outfitter_hold_option_buy_or_sell_amount.png,
// trade_center_hold_option_amount.png): a white panel with an
// "Enter quantity:" label, a black entry field with white digits, and
// grey bevel Cancel / <verb> buttons. It is not one of the game's
// PICT frames, so it's drawn with Graphics.
// Measured off trade_center/buy_quantity.png (1920x1080): the panel is
// centred on the screen at x874..1045, y504..575; its entry field is
// x983..1040, y508..530; Cancel is x885..954 and the default button
// x966..1036, both y546..565. (The original's is a NATIVE macOS dialog
// — blue default button, Aqua bevels — so only the rectangles are
// reproduced, not the styling.)
const PANEL_WIDTH = 172;
const PANEL_HEIGHT = 72;
const FIELD_WIDTH = 58;
const FIELD_HEIGHT = 23;
/** Field inset from the panel's right edge / top. */
const FIELD_INSET_RIGHT = 5;
const FIELD_INSET_TOP = 4;
/** "Enter quantity:" ink starts 7px in, its cap 10px down. */
const LABEL_INSET_X = 7;
const LABEL_INSET_Y = 8;
const BUTTON_WIDTH = 70;
const BUTTON_HEIGHT = 20;
const BUTTON_INSET_LEFT = 11;
const BUTTON_INSET_RIGHT = 9;
const BUTTON_INSET_BOTTOM = 10;

/** Longest quantity the field accepts (999,999,999 is beyond any cap). */
const MAX_DIGITS = 9;

const LABEL_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 12, fontWeight: 'bold', fill: 0x000000,
    align: 'left', wordWrap: false,
};
const FIELD_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 12, fill: 0xffffff,
    align: 'left', wordWrap: false,
};

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
 * field, Cancel and a verb button. Resolves with the (clamped)
 * quantity, or undefined on cancel.
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
    private valueText = new PIXI.Text('', FIELD_FONT);
    private confirmButton: SystemButton;
    private text = '';
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

        const left = -PANEL_WIDTH / 2;
        const top = -PANEL_HEIGHT / 2;
        const panel = new PIXI.Graphics()
            // Drop shadow, then the white panel with a thin border.
            .beginFill(0x000000, 0.35)
            .drawRect(left + 3, top + 3, PANEL_WIDTH, PANEL_HEIGHT)
            .endFill()
            .lineStyle(1, 0x000000)
            .beginFill(0xffffff)
            .drawRect(left, top, PANEL_WIDTH, PANEL_HEIGHT)
            .endFill()
            // The entry field: black, inset at the panel's top right.
            .lineStyle(0)
            .beginFill(0x000000)
            .drawRect(left + PANEL_WIDTH - FIELD_WIDTH - FIELD_INSET_RIGHT,
                top + FIELD_INSET_TOP, FIELD_WIDTH, FIELD_HEIGHT)
            .endFill();
        panel.interactive = true;
        this.container.addChild(panel);

        const label = new PIXI.Text('Enter quantity:', LABEL_FONT);
        label.position.set(left + LABEL_INSET_X, top + LABEL_INSET_Y);
        this.container.addChild(label);

        this.valueText.position.set(
            left + PANEL_WIDTH - FIELD_WIDTH - FIELD_INSET_RIGHT + 4,
            top + FIELD_INSET_TOP + 4);
        this.container.addChild(this.valueText);

        const buttonY =
            top + PANEL_HEIGHT - BUTTON_HEIGHT - BUTTON_INSET_BOTTOM;
        const cancel = new SystemButton('Cancel',
            left + BUTTON_INSET_LEFT, buttonY, () => this.close(undefined));
        this.confirmButton = new SystemButton('OK',
            left + PANEL_WIDTH - BUTTON_WIDTH - BUTTON_INSET_RIGHT, buttonY,
            () => this.confirm());
        this.container.addChild(cancel.container,
            this.confirmButton.container);

        this.controls = new MenuControls(controlEvents, {
            depart: () => this.close(undefined),
        });
    }

    private onKey(event: KeyboardEvent) {
        if (!this.container.visible) {
            return;
        }
        if (event.key === 'Enter') {
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
        const edited = editQuantityText(this.text, event.key);
        if (edited !== undefined) {
            this.setText(edited);
        }
    }

    /** Live-clamps the field: entering more than allowed shows the max. */
    private setText(text: string) {
        const clamped = clampQuantity(text, this.max);
        this.text = text === '' ? '' : `${clamped}`;
        this.valueText.text = this.text;
    }

    private confirm() {
        this.close(clampQuantity(this.text, this.max));
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
        this.setText(`${Math.max(0, Math.floor(request.initial))}`);
        this.container.visible = true;
        this.controls.bind();
        // The quantity field owns the keyboard: without this, typed digits
        // (and Enter) would also reach the game's control relay as hotkeys.
        const releaseTextEntry = beginPixiTextEntry();
        document.addEventListener('keydown', this.keyListener);
        try {
            return await firstValueFrom(this.result);
        } finally {
            document.removeEventListener('keydown', this.keyListener);
            releaseTextEntry();
            this.controls.unbind();
            this.container.visible = false;
        }
    }
}

/**
 * A classic grey bevel system button (the reference dialog's Cancel /
 * Buy / Sell), drawn with Graphics rather than the game's red PICT
 * buttons. Shared with the starmap's Find dialog.
 */
export class SystemButton {
    container = new PIXI.Container();
    private label: PIXI.Text;

    constructor(caption: string, x: number, y: number,
        onClick: () => void) {
        this.container.name = `Button:${caption}`;
        this.container.position.set(x, y);

        const face = new PIXI.Graphics()
            .lineStyle(1, 0x000000)
            .beginFill(0xbbbbbb)
            .drawRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT)
            .endFill()
            // Bevel: light top/left, dark bottom/right.
            .lineStyle(1, 0xeeeeee)
            .moveTo(1, BUTTON_HEIGHT - 2).lineTo(1, 1)
            .lineTo(BUTTON_WIDTH - 2, 1)
            .lineStyle(1, 0x777777)
            .lineTo(BUTTON_WIDTH - 2, BUTTON_HEIGHT - 2)
            .lineTo(1, BUTTON_HEIGHT - 2);
        this.container.addChild(face);

        this.label = new PIXI.Text(caption, {
            fontFamily: 'Geneva', fontSize: 12, fontWeight: 'bold',
            fill: 0x000000, align: 'center',
        });
        this.label.anchor.set(0.5);
        this.label.position.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);
        this.container.addChild(this.label);

        this.container.interactive = true;
        this.container.cursor = 'pointer';
        this.container.on('pointerup', onClick);
    }

    setLabel(caption: string) {
        this.label.text = caption;
        // Keep the scene-graph name stable for headless driving:
        // Button:Cancel / Button:Buy / Button:Sell / Button:Bet.
        this.container.name = `Button:${caption}`;
    }
}
