import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { beginPixiTextEntry, isReturnPress } from '../input_focus.js';
import { MenuControls } from './menu_controls.js';

// The starmap's Find dialog, drawn after the original's native Aqua alert
// (map/find_system.png, measured at 1920x1080): a 284x105 white panel with
// a 1 px grey edge, centred on the screen; the application icon (32x32) at
// its top left; "Enter the name of a system to find:" indented 51 px; a
// 206x22 black-edged field under it, indented 57 px; and a white rounded
// Cancel beside the blue default Find button (70x22 each, 12 px apart),
// 11 px above the bottom edge. It is not one of the game's PICT frames, so
// it is drawn with Graphics.
const PANEL_WIDTH = 284;
const PANEL_HEIGHT = 105;
const ICON_X = 7;
const ICON_Y = 5;
const ICON_SIZE = 32;
const TEXT_X = 51;
const TEXT_Y = 6;
const FIELD_X = 57;
const FIELD_Y = 35;
const FIELD_WIDTH = 206;
const FIELD_HEIGHT = 22;
const BUTTON_WIDTH = 70;
const BUTTON_HEIGHT = 22;
const BUTTON_GAP = 12;
const BUTTON_Y = 72;
/** Cancel's left edge; Find sits BUTTON_GAP to its right. */
const CANCEL_X = 83;
const MAX_LENGTH = 40;

/** The original's alert text is the system UI face, regular weight. */
const SYSTEM_FONT = ['-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue',
    'Helvetica', 'Arial', 'sans-serif'];
const LABEL_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: SYSTEM_FONT, fontSize: 13, fill: 0x000000,
    align: 'left', wordWrap: false,
};
const FIELD_FONT: Partial<PIXI.ITextStyle> = {
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
 * `Button:<caption>` for headless driving.
 */
class AquaButton {
    container = new PIXI.Container();

    constructor(caption: string, x: number, y: number, primary: boolean,
        onClick: () => void) {
        this.container.name = `Button:${caption}`;
        this.container.position.set(x, y);

        const face = new PIXI.Graphics();
        if (primary) {
            const bands = new PIXI.Graphics();
            for (let row = 0; row < BUTTON_HEIGHT; row++) {
                bands.beginFill(blend(0x6eb3f8, 0x2184fc,
                    row / (BUTTON_HEIGHT - 1)))
                    .drawRect(0, row, BUTTON_WIDTH, 1)
                    .endFill();
            }
            const mask = new PIXI.Graphics()
                .beginFill(0xffffff)
                .drawRoundedRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 5)
                .endFill();
            bands.mask = mask;
            this.container.addChild(bands, mask);
            face.lineStyle(1, 0x3284f9)
                .drawRoundedRect(0.5, 0.5, BUTTON_WIDTH - 1,
                    BUTTON_HEIGHT - 1, 4.5);
        } else {
            face.lineStyle(1, 0xd2d2d2)
                .beginFill(0xffffff)
                .drawRoundedRect(0.5, 0.5, BUTTON_WIDTH - 1,
                    BUTTON_HEIGHT - 1, 4.5)
                .endFill()
                // The darker bottom edge that reads as a drop shadow.
                .lineStyle(1, 0xbababa)
                .moveTo(4, BUTTON_HEIGHT - 0.5)
                .lineTo(BUTTON_WIDTH - 4, BUTTON_HEIGHT - 0.5);
        }
        this.container.addChild(face);

        const label = new PIXI.Text(caption, {
            ...LABEL_FONT, fill: primary ? 0xffffff : 0x000000,
            align: 'center',
        });
        label.anchor.set(0.5);
        label.position.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);
        this.container.addChild(label);

        this.container.interactive = true;
        this.container.cursor = 'pointer';
        this.container.on('pointerup', onClick);
    }
}

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

        // Whole pixels: the panel is 105 high, so its top sits 52 px above
        // the dialog's origin (y 488 on a 1080-high screen, as measured).
        const left = -Math.floor(PANEL_WIDTH / 2);
        const top = -Math.floor(PANEL_HEIGHT / 2);
        const panel = new PIXI.Graphics()
            // A soft drop shadow, then the panel with its 1 px grey edge.
            .beginFill(0x000000, 0.18)
            .drawRect(left - 2, top, PANEL_WIDTH + 4, PANEL_HEIGHT + 4)
            .endFill()
            .lineStyle(1, 0xa9a9a9)
            .beginFill(0xffffff)
            .drawRect(left - 0.5, top - 0.5, PANEL_WIDTH + 1,
                PANEL_HEIGHT + 1)
            .endFill()
            // The entry field: white with a 1 px black edge.
            .lineStyle(1, 0x000000)
            .beginFill(0xffffff)
            .drawRect(left + FIELD_X + 0.5, top + FIELD_Y + 0.5,
                FIELD_WIDTH - 1, FIELD_HEIGHT - 1)
            .endFill();
        drawIconPlaceholder(panel, left + ICON_X, top + ICON_Y);
        panel.interactive = true;
        this.container.addChild(panel);

        const label = new PIXI.Text('Enter the name of a system to find:',
            LABEL_FONT);
        label.position.set(left + TEXT_X, top + TEXT_Y);
        this.container.addChild(label);

        this.valueText.position.set(left + FIELD_X + 4, top + FIELD_Y + 3);
        this.container.addChild(this.valueText);

        // Cancel and the default Find button sit together right of centre,
        // Find rightmost (map/find_system.png).
        const cancel = new AquaButton('Cancel', left + CANCEL_X,
            top + BUTTON_Y, false, () => this.close(undefined));
        const find = new AquaButton('Find',
            left + CANCEL_X + BUTTON_WIDTH + BUTTON_GAP, top + BUTTON_Y, true,
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
        if (isReturnPress(event)) {
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
