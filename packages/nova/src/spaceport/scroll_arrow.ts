import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { RoundButton } from './round_button.js';

/**
 * Where an arrow's position sits on its round button: callers place an
 * arrow by its disc's centre, and the button is drawn from its caps'
 * top-left this far up and left of it. Measured on
 * outfitter/earth_outfitter_cant_have_any.png: the up arrow's caps start at
 * (725, 668) — the same bezel pixels the star map's zoom buttons show at
 * their own button origin — for the centre (738, 679.5) the outfitter
 * places it at; the mission popup's pair on
 * spaceport/kiniké_kont_probe_mission_offer_in_spaceport.png agrees.
 */
export const SCROLL_ARROW_PIVOT = { x: 13, y: 11.5 } as const;

/** The disc's radius for hit testing, socket included. */
const HIT_RADIUS = 10.5;

/**
 * A round scroll-arrow button: the outfitter, shipyard and hire-escort
 * grids each have an up/down pair at their bottom-left, and a mission-text
 * popup too long for its frame has one right of its buttons. A grid's
 * pair is ALWAYS shown, greyed at either end of the list — the shipyard
 * capture shows both arrows disabled over a list that fits on one page.
 *
 * It is the original's construction (round_button.ts): the button caps
 * without a middle, in their normal / pressed / grey states, with a
 * chevron on the disc.
 */
export class ScrollArrow {
    readonly container: PIXI.Container;
    /** Fires on release over an enabled arrow (a grid's one row). */
    readonly click = new Subject<void>();
    /** Fires on press-down over an enabled arrow, for owners that scroll
     * while the arrow is HELD (the mission-text popup). A greyed arrow
     * ignores the press entirely. */
    readonly press = new Subject<void>();
    private button: RoundButton;
    private wrappedEnabled = true;

    constructor(displayAssets: DisplayAssetDataInterface,
        direction: 'up' | 'down') {
        this.button = new RoundButton(displayAssets, direction);
        // The button's own container, so pointer events reach its press
        // state machine directly.
        this.container = this.button.container;
        this.container.name = `ScrollArrow:${direction}`;
        this.container.pivot.set(SCROLL_ARROW_PIVOT.x, SCROLL_ARROW_PIVOT.y);
        // An explicit hit area so the whole socket is reliably clickable
        // (and the caps' transparent corners are not).
        this.container.hitArea = new PIXI.Circle(SCROLL_ARROW_PIVOT.x,
            SCROLL_ARROW_PIVOT.y, HIT_RADIUS);
        this.button.press.subscribe(() => this.press.next());
        this.button.click.subscribe(() => {
            if (this.wrappedEnabled) {
                this.click.next();
            }
            this.showEnabled();
        });
        // A press greyed mid-hold (the popup reaching its end) comes back
        // grey, not to the state it was pressed from.
        this.container.on('pointerupoutside', () => this.showEnabled());
    }

    get enabled() {
        return this.wrappedEnabled;
    }

    set enabled(value: boolean) {
        if (value === this.wrappedEnabled) {
            return;
        }
        this.wrappedEnabled = value;
        this.showEnabled();
    }

    /** The button's look for `enabled`; a held press keeps its pressed
     * look until the release. */
    private showEnabled() {
        if (this.button.state !== 'clicked') {
            this.button.state = this.wrappedEnabled ? 'normal' : 'grey';
        }
    }
}
