import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';

const BUTTON_IDS = new Map([
    ['normal', {
        left: 'nova:7500',
        middle: 'nova:7501',
        right: 'nova:7502',
    }],
    ['clicked', {
        left: 'nova:7503',
        middle: 'nova:7504',
        right: 'nova:7505'
    }],
    ['grey', {
        left: 'nova:7506',
        middle: 'nova:7507',
        right: 'nova:7508'
    }],
]);

const LEFT_POS = 13.2 // TODO: infer from texture width

/** Modifier state of a button click. `option` is the option/alt key,
 * which the original uses for bulk buy/sell quantity entry. */
export interface ButtonClick {
    option: boolean;
    /** The shift key was held: the debug trade override modifier. */
    shift: boolean;
}

/** A pointer event the press state machine reacts to. */
export type PressEvent = 'down' | 'up' | 'upoutside';

/** What a press event does to a button. `state` undefined = unchanged. */
export interface PressResult {
    state: string | undefined;
    pressedFrom: string | undefined;
    /** Whether this release fires the click. */
    fire: boolean;
}

/**
 * The button press state machine, pure so it is testable without PIXI.
 *
 * A GREYED button ignores presses entirely: no pressed flash on down,
 * and — because no press was recorded — release (on or off the button)
 * neither fires a click nor bounces the visual back to an
 * enabled-looking 'normal'. (Shipped bug: down unconditionally showed
 * 'clicked' and up unconditionally restored 'normal', so clicking a
 * greyed button made it flash pressed and then look clickable.)
 *
 * A drag-off release restores the state the press started from rather
 * than 'normal', so a button greyed mid-press stays grey; without an
 * active press it changes nothing.
 */
export function pressTransition(currentState: string,
    pressedFrom: string | undefined, event: PressEvent,
    /** Let a GREY button take the press anyway (debug override). */
    pressGrey = false): PressResult {
    const unchanged = { state: undefined, pressedFrom, fire: false };
    switch (event) {
        case 'down':
            if (currentState === 'grey' && !pressGrey) {
                return unchanged;
            }
            return { state: 'clicked', pressedFrom: currentState, fire: false };
        case 'up':
            if (pressedFrom === undefined) {
                return unchanged;
            }
            // A grey button pressed through the override goes back to grey
            // (its owner re-greys on refresh anyway); everything else
            // releases to normal.
            return {
                state: pressedFrom === 'grey' ? 'grey' : 'normal',
                pressedFrom: undefined, fire: true,
            };
        case 'upoutside':
            if (pressedFrom === undefined) {
                return unchanged;
            }
            return { state: pressedFrom, pressedFrom: undefined, fire: false };
    }
}

export class Button {
    container = new PIXI.Container();
    private states = new Map<string, PIXI.Container>();
    /**
     * When set, a press on a GREYED button is accepted if this returns true
     * for the pointer event (the outfitter's shift+click debug override).
     */
    pressGreyIf?: (event: PIXI.FederatedPointerEvent) => boolean;
    readonly click = new Subject<ButtonClick>();
    /**
     * Fires on a press-DOWN that the state machine accepted (i.e. never on
     * a greyed button), for press-and-hold controls such as the popup
     * scroll arrows. `click` remains the release-on-button event.
     */
    readonly press = new Subject<void>();
    private text: PIXI.Text;
    private wrappedState = 'normal';
    /** The state to restore if this press is cancelled off the button. */
    private pressedFrom?: string;

    /** Applies a {@link pressTransition} result; returns its `fire`. */
    private applyPress(result: PressResult): boolean {
        this.pressedFrom = result.pressedFrom;
        if (result.state !== undefined) {
            this.state = result.state;
        }
        return result.fire;
    }
    private width: number;

    // See colr resource                                                              
    private font = new Map([
        ["normal", { fontFamily: "Geneva", fontSize: 12, fill: 0xffffff, align: 'center' } as const],
        ["clicked", { fontFamily: "Geneva", fontSize: 12, fill: 0x808080, align: 'center' } as const],
        ["grey", { fontFamily: "Geneva", fontSize: 12, fill: 0x262626, align: 'center' } as const],
    ]);


    constructor(private displayAssets: DisplayAssetDataInterface, text: string,
        width?: number, position?: { x: number, y: number },
        private buttonIds = BUTTON_IDS) {
        // Named for scene-graph queries (debugging and headless UI
        // driving); updated captions keep the original name.
        this.container.name = `Button:${text}`;
        this.container.position.x = position?.x ?? 0;
        this.container.position.y = position?.y ?? 0;

        this.text = new PIXI.Text(text, this.font.get("normal")!);
        this.text.anchor.x = 0.5;
        this.text.anchor.y = 0.5;

        const textMetrics = PIXI.TextMetrics.measureText(text,
            this.text.style as PIXI.TextStyle); // This required cast may be a types bug
        this.width = width ?? textMetrics.width;

        const height = 25; // TODO: infer from texture height
        this.text.position.x = LEFT_POS + this.width / 2;
        this.text.position.y = height / 2;

        // Create a container for each state
        for (const name of this.buttonIds.keys()) {
            const container = new PIXI.Container();
            this.container.addChild(container);
            this.states.set(name, container);
        }

        // Set the correct container as visible
        this.state = this.wrappedState;

        this.container.interactive = true;
        this.container.cursor = 'pointer';
        this.container.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            const result = pressTransition(
                this.wrappedState, this.pressedFrom, 'down',
                this.pressGreyIf?.(event) ?? false);
            this.applyPress(result);
            if (result.state === 'clicked') {
                this.press.next();
            }
        });

        this.container.on('pointerup', (event: PIXI.FederatedPointerEvent) => {
            if (this.applyPress(pressTransition(
                this.wrappedState, this.pressedFrom, 'up'))) {
                this.click.next({ option: event.altKey, shift: event.shiftKey });
            }
        });

        // Releasing the pointer OFF the button cancels the press. Without
        // this the button stays stuck in 'clicked' forever: 'clicked' draws
        // the pressed sprite with grey text, so it is indistinguishable
        // from a disabled button, and refresh loops that skip repainting a
        // 'clicked' row (see the plunder dialog) never recover it. Dialogs
        // are built once per world, so one stray drag-off used to leave a
        // permanently "greyed" button for the rest of the session. Restores
        // the state the button had BEFORE the press, so a genuinely grey
        // button does not come back looking enabled, and fires no click.
        this.container.on('pointerupoutside', () => {
            this.applyPress(pressTransition(
                this.wrappedState, this.pressedFrom, 'upoutside'));
        });

        for (const [name, { left, middle, right }] of this.buttonIds) {
            const stateContainer = this.states.get(name);
            if (!stateContainer) {
                throw new Error('Button missing state container');
            }
            const leftSprite = this.displayAssets.spriteFromPict(left);
            leftSprite.anchor.x = 1;
            leftSprite.position.x = LEFT_POS;
            stateContainer.addChild(leftSprite);

            const middleSprite = new PIXI.TilingSprite(
                this.displayAssets.textureFromPict(middle), this.width, 25);
            middleSprite.position.x = LEFT_POS;
            stateContainer.addChild(middleSprite);

            const rightSprite = this.displayAssets.spriteFromPict(right);
            rightSprite.position.x = LEFT_POS + this.width;
            stateContainer.addChild(rightSprite);

            this.states.set(name, stateContainer);
        }
        this.container.addChild(this.text);
    }

    /**
     * Replaces the button caption (e.g. a mïsn's custom accept/refuse
     * label). The button keeps its constructed width.
     */
    setLabel(label: string) {
        this.text.text = label;
    }

    set state(state: string) {
        for (const container of this.states.values()) {
            container.visible = false;
        }
        const container = this.states.get(state);
        if (container) {
            container.visible = true;
        }

        const font = this.font.get(state);
        if (font) {
            this.text.style = font;
        }

        this.wrappedState = state;
    }

    get state() {
        return this.wrappedState;
    }
}
