import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { beginPixiTextEntry } from '../input_focus.js';
import { MenuControls } from './menu_controls.js';
import { SystemButton } from './quantity_dialog.js';

// The starmap's Find dialog (map/find_system.png): a plain white system
// panel with "Enter the name of a system to find:", a text field, and
// Cancel / Find buttons. Like the quantity dialog, it is not one of the
// game's PICT frames, so it's drawn with Graphics.
const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 104;
const FIELD_HEIGHT = 20;
const BUTTON_WIDTH = 78;
const BUTTON_HEIGHT = 26;
const MAX_LENGTH = 40;

const LABEL_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 12, fontWeight: 'bold', fill: 0x000000,
    align: 'left', wordWrap: false,
};
const FIELD_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 12, fill: 0x000000,
    align: 'left', wordWrap: false,
};

/**
 * Applies one typed key to the find field's text. Returns the new text,
 * or undefined for keys the field ignores. Pure, for tests.
 */
export function editFindText(current: string,
    key: string): string | undefined {
    if (key === 'Backspace') {
        return current.slice(0, -1);
    }
    // Single printable characters (letters, digits, space, '-', ''', ...).
    if (key.length === 1) {
        if (current.length >= MAX_LENGTH) {
            return current;
        }
        return current + key;
    }
    return undefined;
}

/**
 * The Find dialog: resolves with the entered system name, or undefined on
 * cancel. Focus discipline mirrors QuantityDialog: its MenuControls sits on
 * top of the focus stack while shown, and printable keys arrive through a
 * raw keydown listener (which stops propagation so typing 'd', 'm', 'j'...
 * can't trigger game controls).
 */
export class FindDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private result = new Subject<string | undefined>();
    private valueText = new PIXI.Text('', FIELD_FONT);
    private text = '';
    private keyListener = (event: KeyboardEvent) => this.onKey(event);

    constructor(controlEvents: Observable<ControlEvent>) {
        this.container.name = 'FindDialog';
        this.container.visible = false;

        // A modal shield: swallows pointer events so the map behind the
        // dialog can't be clicked or dragged while it's up.
        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001)
            .drawRect(-2000, -2000, 4000, 4000)
            .endFill();
        shield.interactive = true;
        this.container.addChild(shield);

        const left = -PANEL_WIDTH / 2;
        const top = -PANEL_HEIGHT / 2;
        const panel = new PIXI.Graphics()
            .beginFill(0x000000, 0.35)
            .drawRect(left + 3, top + 3, PANEL_WIDTH, PANEL_HEIGHT)
            .endFill()
            .lineStyle(1, 0x000000)
            .beginFill(0xffffff)
            .drawRect(left, top, PANEL_WIDTH, PANEL_HEIGHT)
            .endFill()
            // The entry field: white with a dark inset border.
            .lineStyle(1, 0x404040)
            .beginFill(0xffffff)
            .drawRect(left + 12, top + 34, PANEL_WIDTH - 24, FIELD_HEIGHT)
            .endFill();
        panel.interactive = true;
        this.container.addChild(panel);

        const label = new PIXI.Text('Enter the name of a system to find:',
            LABEL_FONT);
        label.position.set(left + 12, top + 12);
        this.container.addChild(label);

        this.valueText.position.set(left + 17, top + 37);
        this.container.addChild(this.valueText);

        const buttonY = top + PANEL_HEIGHT - BUTTON_HEIGHT - 10;
        // The original's Find sheet groups Cancel and Find together at the
        // bottom, adjacent and slightly right of center, with the primary
        // (Find) rightmost (map/find_system.png) — not spread to opposite
        // corners. Match that grouping.
        const gap = 8;
        const groupWidth = 2 * BUTTON_WIDTH + gap;
        const cancelX = -groupWidth / 2 + 18;
        const cancel = new SystemButton('Cancel',
            cancelX, buttonY, () => this.close(undefined));
        const find = new SystemButton('Find',
            cancelX + BUTTON_WIDTH + gap, buttonY,
            () => this.close(this.text));
        this.container.addChild(cancel.container, find.container);

        this.controls = new MenuControls(controlEvents, {});
    }

    private onKey(event: KeyboardEvent) {
        if (!this.container.visible) {
            return;
        }
        // The field owns the keyboard: keys must not fall through to the
        // game's controls (typing a name full of 'd's and 'm's...).
        event.stopImmediatePropagation();
        event.preventDefault();
        if (event.key === 'Enter') {
            this.close(this.text);
            return;
        }
        if (event.key === 'Escape') {
            this.close(undefined);
            return;
        }
        const edited = editFindText(this.text, event.key);
        if (edited !== undefined) {
            this.text = edited;
            this.valueText.text = edited;
        }
    }

    private close(value: string | undefined) {
        this.result.next(value);
    }

    /** Shows the dialog; resolves with the entered name or undefined. */
    async show(): Promise<string | undefined> {
        this.text = '';
        this.valueText.text = '';
        this.container.visible = true;
        this.controls.bind();
        // This field owns the keyboard while it's up. Two lines of defense:
        // the capture-phase listener below stops typed keys from propagating
        // to the game's relay, and registering as a text-entry surface makes
        // the relay itself stand down (so nothing slips through even if
        // propagation ever changes).
        const releaseTextEntry = beginPixiTextEntry();
        // Capture phase, ahead of the game's keyboard plugin.
        window.addEventListener('keydown', this.keyListener, true);
        try {
            const name = await firstValueFrom(this.result);
            return name?.trim() ? name.trim() : undefined;
        } finally {
            window.removeEventListener('keydown', this.keyListener, true);
            releaseTextEntry();
            this.controls.unbind();
            this.container.visible = false;
        }
    }
}
