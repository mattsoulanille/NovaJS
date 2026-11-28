import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { isReturnPress } from '../input_focus.js';
import {
    ALERT_ICON_X, ALERT_ICON_Y, ALERT_LABEL_FONT, AquaButton,
    drawIconPlaceholder,
} from './alert_prompt.js';
import { MenuControls } from './menu_controls.js';

/**
 * The original's native Aqua YES/NO ALERT: a question and Cancel beside
 * the blue default OK, with no text field (alert_prompt.ts is the one
 * with a field). Measured on the player-info dialog's Jettison Cargo
 * confirmation (reference "Jettison cargo, wave 55",
 * run2/04-landed_jet_click.png, an 832x604 window): the white panel spans
 * x 239..593, y 248..356, centred on the window; the question's ink starts
 * at (292, 256); Cancel spans x 420..489 and OK x 502..571, both y
 * 323..343.
 */
export interface AlertConfirmLayout {
    width: number;
    height: number;
    textX: number;
    textY: number;
    cancelX: number;
    confirmX: number;
    buttonY: number;
    buttonWidth: number;
    buttonHeight: number;
}

export const JETTISON_CONFIRM_LAYOUT: AlertConfirmLayout = {
    width: 356,
    height: 110,
    textX: 53,
    textY: 6,
    cancelX: 181,
    confirmX: 263,
    buttonY: 75,
    buttonWidth: 70,
    buttonHeight: 21,
};

/**
 * The alert: resolves true on OK (or Return), false on Cancel (or
 * Escape). While shown it owns the keyboard (its MenuControls tops the
 * focus stack, and a capture-phase listener answers Return / Escape), and
 * a modal shield swallows pointer events outside the panel.
 */
export class AlertConfirmDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private result = new Subject<boolean>();
    private promptText: PIXI.Text;
    private confirmButton: AquaButton;
    private keyListener = (event: KeyboardEvent) => this.onKey(event);

    constructor(controlEvents: Observable<ControlEvent>, name: string,
        layout: AlertConfirmLayout = JETTISON_CONFIRM_LAYOUT) {
        this.container.name = name;
        this.container.visible = false;

        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001)
            .drawRect(-2000, -2000, 4000, 4000)
            .endFill();
        shield.eventMode = 'static';
        this.container.addChild(shield);

        const left = -Math.floor(layout.width / 2);
        const top = -Math.floor(layout.height / 2);
        const panel = new PIXI.Graphics()
            .beginFill(0x000000, 0.18)
            .drawRect(left - 2, top, layout.width + 4, layout.height + 4)
            .endFill()
            .lineStyle(1, 0xa9a9a9)
            .beginFill(0xffffff)
            .drawRect(left - 0.5, top - 0.5, layout.width + 1,
                layout.height + 1)
            .endFill();
        drawIconPlaceholder(panel, left + ALERT_ICON_X, top + ALERT_ICON_Y);
        panel.eventMode = 'static';
        this.container.addChild(panel);

        this.promptText = new PIXI.Text('', {
            ...ALERT_LABEL_FONT, wordWrap: true,
            wordWrapWidth: layout.width - layout.textX - 10,
        });
        this.promptText.position.set(left + layout.textX, top + layout.textY);
        this.container.addChild(this.promptText);

        const cancel = new AquaButton('Cancel', left + layout.cancelX,
            top + layout.buttonY, layout.buttonWidth, layout.buttonHeight,
            false, () => this.result.next(false));
        this.confirmButton = new AquaButton('OK', left + layout.confirmX,
            top + layout.buttonY, layout.buttonWidth, layout.buttonHeight,
            true, () => this.result.next(true));
        this.container.addChild(cancel.container,
            this.confirmButton.container);

        this.controls = new MenuControls(controlEvents, {});
        // `y` presses OK and `n` Cancel, through the key relay
        // (MenuControls.pressAnswerKey), like any choice dialog's.
        this.controls.answerButtons = {
            yes: () => this.result.next(true),
            no: () => this.result.next(false),
        };
    }

    /** Whether the alert is up. */
    get shown(): boolean {
        return this.container.visible;
    }

    private onKey(event: KeyboardEvent) {
        if (!this.container.visible) {
            return;
        }
        if (isReturnPress(event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.result.next(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.result.next(false);
        }
    }

    /** Shows `prompt`; resolves true on OK, false on Cancel. */
    async show(prompt: string, confirm = 'OK'): Promise<boolean> {
        this.promptText.text = prompt;
        this.confirmButton.setLabel(confirm);
        this.container.visible = true;
        this.controls.bind();
        // Headless (specs, under node) there is no window: the alert is
        // answered through confirm() / cancel() instead.
        const target = typeof window !== 'undefined' ? window : undefined;
        try {
            target?.addEventListener('keydown', this.keyListener, true);
            return await firstValueFrom(this.result);
        } finally {
            target?.removeEventListener('keydown', this.keyListener, true);
            this.controls.unbind();
            this.container.visible = false;
        }
    }

    /** Presses OK (headless driving). */
    confirm() {
        this.result.next(true);
    }

    /** Presses Cancel (headless driving). */
    cancel() {
        this.result.next(false);
    }
}
