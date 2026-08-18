/**
 * The text the shipyard's price pane shows, kept free of PIXI so it can
 * be unit-tested the way display/status_bar_content.ts is.
 *
 * The layout and wording come from the original, measured against
 * ui_screenshots/original_macos_screenshots/shipyard/earth_spaceport.png,
 * which shows the pane under the ship picture reading:
 *
 *     Ship Price:    10,000 cr
 *     Trade-In:      70,500 cr
 *
 *     Final Price:   0 cr
 *
 *     You Have:      546,553 cr
 *
 * (that shot is a Shuttle selected while flying something far more
 * valuable, which is why the trade-in dwarfs the price and the final
 * price is the clamped 0 of shipPurchasePrice's judgment call 4).
 *
 * Every number here is produced by the same shipyard_rules functions the
 * purchase itself charges through -- shipListPrice, tradeInValue and
 * shipPurchasePrice -- so the quoted price can never drift from the amount
 * debited. In particular the exclusion of persistent (oütf 0x0004) outfits
 * from the trade-in, and the ränk PriceMod applied to the "Ship Price" line
 * (price_mod.ts), are inherited rather than restated.
 */
import { ShipData } from 'novadatainterface/ship_data';
import { formatPrice } from './format_price.js';
import {
    ShipPurchaseContext,
    shipListPrice,
    shipPurchasePrice,
    tradeInValue,
} from './shipyard_rules.js';

/** The four label/value rows of the shipyard's price pane. */
export interface ShipyardPriceReadout {
    /** The selected ship's list price (shïp Cost). */
    shipPrice: string;
    /** What the current ship and its non-persistent outfits are worth. */
    tradeIn: string;
    /** What the player is actually charged: price - trade-in, min 0. */
    finalPrice: string;
    /** The player's credits. */
    youHave: string;
}

/** The labels, in the original's wording and row order. */
export const SHIPYARD_PRICE_LABELS = {
    shipPrice: 'Ship Price:',
    tradeIn: 'Trade-In:',
    finalPrice: 'Final Price:',
    youHave: 'You Have:',
} as const;

/**
 * The price pane's two columns, in menu-container coordinates (the menu
 * is centred, so screen x = 960 + these).
 *
 * Measured on earth_spaceport.png: the labels' ink begins at screen x
 * 1192 and the values' at 1262. Our PIXI.Text draws its first glyph at
 * the box's left edge, so the boxes go at 1192 / 1262.
 *
 * These are NOT the outfitter's columns, which an earlier comment here
 * asserted: the SAME string "You Have:" starts at x 1192 in
 * shipyard/earth_spaceport.png but at x 1196 in
 * outfitter/earth_outfitter_cant_hold_any.png. The original's outfitter
 * info pane sits four pixels right (and one pixel down) of the
 * shipyard's, so each menu carries its own numbers.
 */
export const SHIPYARD_PRICE_COLUMNS = { label: 232, value: 302 } as const;

/**
 * The y of each price row: the PIXI.Text box top, whose ink starts 2px
 * lower. Measured at ink rows 598 / 610 / 634 / 658 in
 * earth_spaceport.png -- a 12px line pitch with a blank line before
 * "Final Price:" and another before "You Have:".
 */
export const SHIPYARD_PRICE_ROWS = {
    shipPrice: 56,
    tradeIn: 68,
    finalPrice: 92,
    youHave: 116,
} as const;

/** One pill in the shipyard's button row. */
export interface ShipyardButtonSpec {
    /** The caption the original prints on the pill. */
    label: string;
    /**
     * The width handed to Button: the tiling middle only. The two end
     * caps add roughly BUTTON_CAP_WIDTH each, so the pill on screen is
     * wider than this by about 2 * BUTTON_CAP_WIDTH.
     */
    width: number;
    x: number;
    y: number;
}

/**
 * Button.LEFT_POS -- the cap sprites' inset, which stands in for the cap
 * texture's width (see the TODO in button.ts). Mirrored here so the
 * layout specs can reason about a pill's rendered extent.
 */
export const BUTTON_CAP_WIDTH = 13.2;

/**
 * The shipyard's button row: "Info", "Buy Ship", "Done", measured off
 * earth_spaceport.png rather than guessed.
 *
 * How the numbers were taken: the pills' red faces sit at screen x
 * 836-910 / 948-1042 / 1063-1157, all on the same row. Against our own
 * capture, a pill's red face starts a fixed offset right of the
 * container's x and runs (width + 12)px, which inverts to the x and
 * width here (confirmed by sweeping the row horizontally: dx=0 is the
 * minimum).
 *
 * The y is NOT inferrable the same way -- the red face sits low inside
 * the 25px pill sprite, so matching red-face rows lands the sprite
 * wrong. It was swept instead, moving the row a pixel at a time in the
 * live page and diffing the region against the reference
 * (visual_compare/sweep_button_y.mjs): a clean V with its minimum at
 * 128, 20.4% against 46-63% for the neighbourhood.
 *
 * The original's middle pill says "Buy Ship", not "Buy" -- and it is
 * visibly wider than the Info pill, which is what gave the old
 * uniform-60 row away.
 */
export const SHIPYARD_BUTTONS = {
    info: { label: 'Info', width: 63, x: -129, y: 128 },
    buy: { label: 'Buy Ship', width: 83, x: -17, y: 128 },
    done: { label: 'Done', width: 83, x: 98, y: 128 },
} as const satisfies Record<string, ShipyardButtonSpec>;

/**
 * How far right a pill reaches in container coordinates: its x plus the
 * tiling middle, plus a cap at each end.
 */
export function buttonRightEdge(spec: ShipyardButtonSpec): number {
    return spec.x + spec.width + 2 * BUTTON_CAP_WIDTH;
}

/**
 * The price pane for `newShip` given the player's current state, or
 * undefined when there is nothing to price yet -- no selection, or the
 * current hull's ShipData still loading. The menu blanks the pane in
 * that case rather than quote a trade-in computed from an incomplete
 * valuation, which is the same reason canBuyShip is refused there.
 */
export function shipyardPriceReadout(newShip: ShipData | undefined,
    context: ShipPurchaseContext | undefined): ShipyardPriceReadout | undefined {
    if (!newShip || !context) {
        return undefined;
    }
    return {
        shipPrice: formatPrice(shipListPrice(newShip, context)),
        tradeIn: formatPrice(tradeInValue(context)),
        finalPrice: formatPrice(shipPurchasePrice(newShip, context)),
        youHave: formatPrice(context.credits),
    };
}
