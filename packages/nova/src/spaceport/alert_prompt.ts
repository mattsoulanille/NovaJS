import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { beginPixiTextEntry, isReturnPress } from '../input_focus.js';
import { MenuControls } from './menu_controls.js';

/**
 * The original's native Aqua ALERT with a one-line text field: the
 * starmap's Find ("Enter the name of a system to find:") and the
 * shipyard's Buy Ship prompt ("Please name your new <ship>:"). A white
 * panel with a 1 px grey edge, centred on the screen; the application
 * icon (32x32) at its top left; the prompt beside it; a white field with
 * a 1 px black edge; a white rounded Cancel beside the blue default
 * button. It is not one of the game's PICT frames, so it is drawn with
 * Graphics. Each use has its own measured rectangles
 * ({@link AlertPromptLayout}), as each is its own dialog resource in the
 * original.
 */
export interface AlertPromptLayout {
    width: number;
    height: number;
    /** The prompt's text box, from the panel's top left. */
    textX: number;
    textY: number;
    fieldX: number;
    fieldY: number;
    fieldWidth: number;
    fieldHeight: number;
    cancelX: number;
    /** The default (confirm) button's left edge. */
    confirmX: number;
    buttonY: number;
    buttonWidth: number;
    buttonHeight: number;
}

const ICON_X = 7;
const ICON_Y = 5;
const ICON_SIZE = 32;
/** The field's text starts this far inside its edge. */
const FIELD_TEXT_INSET_X = 4;
const FIELD_TEXT_INSET_Y = 3;
/**
 * The select-all highlight: the field's interior, 4 px in from its left
 * edge, 3 px from the others (ship name prompt, 09-buy-confirm.png: field
 * x324..529, y294..315, highlight x328..526, y297..312), in the system's
 * selection blue.
 */
export const SELECTION_INSET_LEFT = 4;
export const SELECTION_INSET = 3;
export const SELECTION_COLOR = 0xb2d7ff;

/** The original's alert text is the system UI face, regular weight. */
const SYSTEM_FONT = ['-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue',
    'Helvetica', 'Arial', 'sans-serif'];
export const ALERT_LABEL_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: SYSTEM_FONT, fontSize: 13, fill: 0x000000,
    align: 'left', wordWrap: false,
};

/**
 * Where the alert's application icon goes. The original shows EV Nova's
 * own application icon, which lives in the application bundle, not in the
 * game data: the data files carry no icon-sized cicn or PICT (their cicns
 * are 16x16 marks, a 32x16 badge and two 60x40 images). So this draws a
 * neutral placeholder tile of the same size; swap in a real texture here if
 * an icon resource ever becomes available.
 */
function drawIconPlaceholder(g: PIXI.Graphics, x: number, y: number) {
    g.lineStyle(1, 0x5a5a5a)
        .beginFill(0x1c1c1c)
        .drawRoundedRect(x + 0.5, y + 0.5, ICON_SIZE - 1, ICON_SIZE - 1, 5)
        .endFill()
        .lineStyle(0)
        .beginFill(0x8a8a8a)
        .drawPolygon([x + 7, y + 23, x + 26, y + 9, x + 21, y + 24])
        .endFill();
}

/** Linear blend of two 0xRRGGBB colours (t in [0, 1]). */
function blend(from: number, to: number, t: number): number {
    const channel = (shift: number) => {
        const a = (from >> shift) & 0xff;
        const b = (to >> shift) & 0xff;
        return Math.round(a + (b - a) * t) << shift;
    };
    return channel(16) | channel(8) | channel(0);
}

/**
 * An Aqua push button: the white rounded Cancel, or the blue default
 * button (a top-to-bottom gradient, drawn as 1 px bands under a rounded
 * mask so it needs no canvas texture). The container is named
 * `Button:<caption>` for headless driving. Shared with the bulk quantity
 * dialog (quantity_dialog.ts).
 */
export class AquaButton {
    container = new PIXI.Container();
    private label: PIXI.Text;

    constructor(caption: string, x: number, y: number, width: number,
        height: number, primary: boolean, onClick: () => void) {
        this.container.name = `Button:${caption}`;
        this.container.position.set(x, y);

        const face = new PIXI.Graphics();
        if (primary) {
            const bands = new PIXI.Graphics();
            for (let row = 0; row < height; row++) {
                bands.beginFill(blend(0x6eb3f8, 0x2184fc,
                    row / (height - 1)))
                    .drawRect(0, row, width, 1)
                    .endFill();
            }
            const mask = new PIXI.Graphics()
                .beginFill(0xffffff)
                .drawRoundedRect(0, 0, width, height, 5)
                .endFill();
            bands.mask = mask;
            this.container.addChild(bands, mask);
            face.lineStyle(1, 0x3284f9)
                .drawRoundedRect(0.5, 0.5, width - 1, height - 1, 4.5);
        } else {
            face.lineStyle(1, 0xd2d2d2)
                .beginFill(0xffffff)
                .drawRoundedRect(0.5, 0.5, width - 1, height - 1, 4.5)
                .endFill()
                // The darker bottom edge that reads as a drop shadow.
                .lineStyle(1, 0xbababa)
                .moveTo(4, height - 0.5)
                .lineTo(width - 4, height - 0.5);
        }
        this.container.addChild(face);

        this.label = new PIXI.Text(caption, {
            ...ALERT_LABEL_FONT, fill: primary ? 0xffffff : 0x000000,
            align: 'center',
        });
        this.label.anchor.set(0.5);
        // Rounded up a half pixel on an odd height (21): the native
        // caption sits 5 px below the top (trade_center/buy_quantity.png).
        this.label.position.set(width / 2, Math.floor(height / 2));
        this.container.addChild(this.label);

        this.container.interactive = true;
        this.container.cursor = 'pointer';
        this.container.on('pointerup', onClick);
    }

    setLabel(caption: string) {
        this.label.text = caption;
        this.container.name = `Button:${caption}`;
    }
}

/** What the field holds: its text, and whether all of it is selected. */
export interface PromptField {
    text: string;
    /** Select-all: the next typed character replaces the whole text. */
    selected: boolean;
}

/** Text length in characters (code points), as the field counts it. */
function length(text: string): number {
    return Array.from(text).length;
}

/**
 * Applies one key press to the field. Returns the new field for keys the
 * field handles, or undefined for keys it ignores. The field has no
 * movable caret: it types at the end, as the Find dialog always has, and
 * the select-all the prompt opens with is the one selection there is.
 *
 *  - a single printable character replaces the selection or is appended
 *    (up to `maxLength` characters);
 *  - Backspace / Delete clears the selection, or deletes the last
 *    character;
 *  - the arrows, Home and End drop the selection (the caret goes to the
 *    end);
 *  - Command-A / Control-A selects everything; any other Command /
 *    Control chord types nothing.
 *
 * Pure, for tests.
 */
export function editPromptField(field: PromptField, key: string,
    maxLength: number, modifiers: { meta?: boolean, ctrl?: boolean } = {}):
    PromptField | undefined {
    if (modifiers.meta || modifiers.ctrl) {
        return key.toLowerCase() === 'a'
            ? { text: field.text, selected: field.text !== '' } : undefined;
    }
    if (key === 'Backspace' || key === 'Delete') {
        if (field.selected) {
            return { text: '', selected: false };
        }
        return key === 'Backspace'
            ? { text: Array.from(field.text).slice(0, -1).join(''),
                selected: false }
            : field;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home',
        'End'].includes(key)) {
        return { text: field.text, selected: false };
    }
    // One printable character: event.key is the character itself (a
    // named key such as 'Tab' or 'F1' is longer than one).
    if (length(key) === 1 && !/[\u0000-\u001f\u007f]/.test(key)) {
        return insertIntoField(field, key, maxLength);
    }
    return undefined;
}

/**
 * Inserts `text` (typed or pasted) at the end, replacing the selection;
 * whatever does not fit in `maxLength` characters is dropped. Pure.
 */
export function insertIntoField(field: PromptField, text: string,
    maxLength: number): PromptField {
    const base = field.selected ? '' : field.text;
    const room = Math.max(0, maxLength - length(base));
    return {
        text: base + Array.from(text).slice(0, room).join(''),
        selected: false,
    };
}

/**
 * What the default button (or Return) does with the field: answers with
 * its text, or, when the text is longer than `acceptLength` characters,
 * REFUSES — the alert stays up with the whole text selected, as the
 * original's ship name prompt does past 64 characters (reference "W1 /
 * C1 / contraband / the shipyard prompt, wave 17", finding 5: 72, 68, 66
 * and 65 refused, 64 accepted). No `acceptLength`, no refusal. Pure.
 */
export function promptAnswer(field: PromptField, acceptLength?: number):
    { accepted: string } | { refused: PromptField } {
    if (acceptLength !== undefined && length(field.text) > acceptLength) {
        return { refused: { text: field.text, selected: field.text !== '' } };
    }
    return { accepted: field.text };
}

/** What one showing of the prompt asks. */
export interface AlertPromptRequest {
    prompt: string;
    /** The default button's caption ('OK', 'Find'). */
    confirm: string;
    /** The field's starting text. */
    initial?: string;
    /** Open with the whole starting text selected. */
    selectAll?: boolean;
}

/**
 * The alert: resolves with the field's raw text on the default button (or
 * Return), undefined on Cancel (or Escape).
 *
 * Focus discipline: its MenuControls sits on top of the focus stack while
 * shown, so the screen behind it hears no navigation or shop keys;
 * registering as a PIXI text-entry surface makes the browser's control
 * relay drop every game hotkey (input_focus.ts); and the capture-phase
 * keydown listener stops each key before any other listener sees it. A
 * modal shield swallows pointer events outside the panel.
 */
export class AlertPromptDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private result = new Subject<string | undefined>();
    private promptText: PIXI.Text;
    private valueText: PIXI.Text;
    private selection = new PIXI.Graphics();
    private caret = new PIXI.Graphics();
    private confirmButton: AquaButton;
    private field: PromptField = { text: '', selected: false };
    private keyListener = (event: KeyboardEvent) => this.onKey(event);
    private pasteListener = (event: ClipboardEvent) => this.onPaste(event);
    private readonly left: number;
    private readonly top: number;

    /**
     * `maxLength` is how many characters the field TAKES (typing and
     * pasting stop there); `acceptLength`, when given, is how many the
     * default button ACCEPTS — a longer text is refused at OK rather than
     * cut while typing ({@link promptAnswer}).
     */
    constructor(controlEvents: Observable<ControlEvent>, name: string,
        private layout: AlertPromptLayout, private maxLength: number,
        private acceptLength?: number) {
        this.container.name = name;
        this.container.visible = false;

        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001)
            .drawRect(-2000, -2000, 4000, 4000)
            .endFill();
        shield.interactive = true;
        this.container.addChild(shield);

        // Whole pixels, so the 1 px edges stay crisp.
        const left = this.left = -Math.floor(layout.width / 2);
        const top = this.top = -Math.floor(layout.height / 2);
        const panel = new PIXI.Graphics()
            // A soft drop shadow, then the panel with its 1 px grey edge.
            .beginFill(0x000000, 0.18)
            .drawRect(left - 2, top, layout.width + 4, layout.height + 4)
            .endFill()
            .lineStyle(1, 0xa9a9a9)
            .beginFill(0xffffff)
            .drawRect(left - 0.5, top - 0.5, layout.width + 1,
                layout.height + 1)
            .endFill()
            // The entry field: white with a 1 px black edge.
            .lineStyle(1, 0x000000)
            .beginFill(0xffffff)
            .drawRect(left + layout.fieldX + 0.5, top + layout.fieldY + 0.5,
                layout.fieldWidth - 1, layout.fieldHeight - 1)
            .endFill();
        drawIconPlaceholder(panel, left + ICON_X, top + ICON_Y);
        panel.interactive = true;
        this.container.addChild(panel);

        // A long prompt (a long ship name) wraps rather than run off the
        // panel's right edge.
        this.promptText = new PIXI.Text('', {
            ...ALERT_LABEL_FONT, wordWrap: true,
            wordWrapWidth: layout.width - layout.textX - 10,
        });
        this.promptText.position.set(left + layout.textX, top + layout.textY);
        this.container.addChild(this.promptText);

        const fieldLeft = left + layout.fieldX;
        const fieldTop = top + layout.fieldY;
        this.selection.beginFill(SELECTION_COLOR)
            .drawRect(fieldLeft + SELECTION_INSET_LEFT,
                fieldTop + SELECTION_INSET,
                layout.fieldWidth - SELECTION_INSET_LEFT - SELECTION_INSET,
                layout.fieldHeight - 2 * SELECTION_INSET)
            .endFill();
        this.container.addChild(this.selection);

        this.valueText = new PIXI.Text('', ALERT_LABEL_FONT);
        this.valueText.position.set(fieldLeft + FIELD_TEXT_INSET_X,
            fieldTop + FIELD_TEXT_INSET_Y);
        // Clipped to the field: a name wider than the box never draws
        // over the panel.
        const fieldMask = new PIXI.Graphics()
            .beginFill(0xffffff)
            .drawRect(fieldLeft + 1, fieldTop + 1, layout.fieldWidth - 2,
                layout.fieldHeight - 2)
            .endFill();
        this.valueText.mask = fieldMask;
        this.container.addChild(this.valueText, fieldMask);

        this.caret.beginFill(0x000000)
            .drawRect(0, 0, 1, layout.fieldHeight - 2 * SELECTION_INSET - 2)
            .endFill();
        this.caret.position.y = fieldTop + SELECTION_INSET + 1;
        this.container.addChild(this.caret);

        const cancel = new AquaButton('Cancel', left + layout.cancelX,
            top + layout.buttonY, layout.buttonWidth, layout.buttonHeight,
            false, () => this.close(undefined));
        this.confirmButton = new AquaButton('OK', left + layout.confirmX,
            top + layout.buttonY, layout.buttonWidth, layout.buttonHeight,
            true, () => this.submit());
        this.container.addChild(cancel.container,
            this.confirmButton.container);

        this.controls = new MenuControls(controlEvents, {});
    }

    /** Whether the prompt is up. */
    get shown(): boolean {
        return this.container.visible;
    }

    /** The field as it stands, for headless driving and specs. */
    get value(): PromptField {
        return { ...this.field };
    }

    private setField(field: PromptField) {
        this.field = field;
        this.valueText.text = field.text;
        this.selection.visible = field.selected;
        this.caret.visible = !field.selected;
        this.caret.position.x = Math.min(
            this.valueText.position.x + this.valueText.width,
            this.left + this.layout.fieldX + this.layout.fieldWidth - 3);
    }

    private onKey(event: KeyboardEvent) {
        if (!this.container.visible) {
            return;
        }
        // The field owns the keyboard: no key may fall through to the
        // game's controls or the screen behind (a name full of 'd's,
        // 'm's and 'b's must not depart, open the map or buy).
        event.stopImmediatePropagation();
        // Return, not Option+Return (the fullscreen shortcut, which this
        // field keeps, as the Find field always has).
        if (isReturnPress(event)) {
            event.preventDefault();
            this.submit();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            this.close(undefined);
            return;
        }
        // Command-V / Control-V is left to the browser, which fires the
        // paste event onPaste handles.
        if ((event.metaKey || event.ctrlKey)
            && event.key.toLowerCase() === 'v') {
            return;
        }
        event.preventDefault();
        const edited = editPromptField(this.field, event.key,
            this.maxLength, { meta: event.metaKey, ctrl: event.ctrlKey });
        if (edited !== undefined) {
            this.setField(edited);
        }
    }

    private onPaste(event: ClipboardEvent) {
        if (!this.container.visible) {
            return;
        }
        event.preventDefault();
        const pasted = event.clipboardData?.getData('text/plain') ?? '';
        // One line: everything from the first line break on is dropped,
        // and the caller cleans the rest (controls and all).
        const line = pasted.split(/[\r\n]/)[0];
        this.setField(insertIntoField(this.field, line, this.maxLength));
    }

    private close(value: string | undefined) {
        this.result.next(value);
    }

    /** The default button: answer, or refuse a text that is too long. */
    private submit() {
        const answer = promptAnswer(this.field, this.acceptLength);
        if ('refused' in answer) {
            this.setField(answer.refused);
            return;
        }
        this.close(answer.accepted);
    }

    /** Shows the prompt; resolves with the field's text, or undefined. */
    async show(request: AlertPromptRequest): Promise<string | undefined> {
        this.promptText.text = request.prompt;
        this.confirmButton.setLabel(request.confirm);
        const initial = Array.from(request.initial ?? '')
            .slice(0, this.maxLength).join('');
        this.setField({
            text: initial, selected: (request.selectAll ?? false)
                && initial !== '',
        });
        this.container.visible = true;
        this.controls.bind();
        const releaseTextEntry = beginPixiTextEntry();
        // Headless (specs, under node) there is no window: the prompt is
        // answered through confirm() / cancel() instead.
        const target = typeof window !== 'undefined' ? window : undefined;
        try {
            // Capture phase, ahead of the game's keyboard plugin.
            target?.addEventListener('keydown', this.keyListener, true);
            target?.addEventListener('paste', this.pasteListener, true);
            return await firstValueFrom(this.result);
        } finally {
            target?.removeEventListener('keydown', this.keyListener, true);
            target?.removeEventListener('paste', this.pasteListener, true);
            releaseTextEntry();
            this.controls.unbind();
            this.container.visible = false;
        }
    }

    /**
     * Presses the default button (headless driving): answers the prompt,
     * or leaves it up with its text reselected when the text is longer
     * than the button accepts.
     */
    confirm() {
        this.submit();
    }

    /** Answers the prompt as its Cancel button would (headless driving). */
    cancel() {
        this.close(undefined);
    }

    /** Replaces the field's text, unselected (headless driving). */
    type(text: string) {
        this.setField(insertIntoField({ text: '', selected: false }, text,
            this.maxLength));
    }
}
