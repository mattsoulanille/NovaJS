// The landed UI's scroll wheel, two NovaJS Enhancements: "Scroll wheel in
// shops" turns wheel events over the outfitter, shipyard and hire grids
// into whole-row scroll steps, and "Scroll wheel in text" turns them into
// px of mission-text scroll. Pure, so the mapping is unit tested
// (grid_wheel_test.ts); item_grid.ts and offer_popup.ts bind it to PIXI's
// wheel event.
//
// The original's grids scroll only by their arrow buttons (a row a click)
// and the keyboard, and its mission text only by the arrows and the keys;
// the wheel does nothing over either.
import {
    DOM_DELTA_LINE, DOM_DELTA_PAGE, LINE_PX, PAGE_PX, WheelMapper,
    WheelSample,
} from './starmap_gestures.js';
import { POPUP_WHEEL_NOTCH_PX } from './popup_layout.js';

/**
 * CSS px of continuous (trackpad) scroll per grid row: one tile's height
 * (item_grid.ts TILE_SIZE[1]), so the rows move about as far as the
 * fingers do at UI scale 1.
 */
export const GRID_ROW_PX = 54;

/**
 * Maps wheel events to rows, positive = down the list (towards later
 * items), as a page scrolls under the same wheel.
 *
 * - A classic notched wheel (starmap_gestures.ts looksNotched, with the
 *   same trackpad latch) scrolls ONE row per detent event, whatever size
 *   the browser reports the detent as.
 * - A trackpad's two-finger scroll accumulates its pixel deltas and steps
 *   a row each {@link GRID_ROW_PX}, carrying the remainder, so a slow drag
 *   still moves and a fling moves several rows. Reversing direction drops
 *   the carry, so the first row back is not swallowed.
 * - A pinch (ctrl+wheel) and a sideways-only scroll do nothing.
 */
export class WheelRowStepper {
    private readonly mapper = new WheelMapper();
    private carry = 0;

    rows(sample: WheelSample): number {
        if (sample.ctrlKey || sample.deltaY === 0) {
            return 0;
        }
        if (this.mapper.isNotched(sample)) {
            this.carry = 0;
            return Math.sign(sample.deltaY);
        }
        const unit = sample.deltaMode === DOM_DELTA_LINE ? LINE_PX
            : sample.deltaMode === DOM_DELTA_PAGE ? PAGE_PX : 1;
        const delta = sample.deltaY * unit;
        if (this.carry !== 0 && Math.sign(delta) !== Math.sign(this.carry)) {
            this.carry = 0;
        }
        this.carry += delta;
        const rows = Math.trunc(this.carry / GRID_ROW_PX);
        this.carry -= rows * GRID_ROW_PX;
        return rows;
    }
}

/**
 * Maps wheel events over the mission text to px of scroll (positive =
 * further down), for the "Scroll wheel in text" NovaJS Enhancement: a
 * notched wheel moves {@link POPUP_WHEEL_NOTCH_PX} a detent, a trackpad
 * moves the text as far as the fingers go, and a pinch (ctrl+wheel) does
 * nothing. The original's wheel does nothing over text at all.
 */
export class TextWheelScroller {
    private readonly mapper = new WheelMapper();

    pixels(sample: WheelSample): number {
        if (sample.ctrlKey || sample.deltaY === 0) {
            return 0;
        }
        if (this.mapper.isNotched(sample)) {
            return Math.sign(sample.deltaY) * POPUP_WHEEL_NOTCH_PX;
        }
        return sample.deltaY;
    }
}
