// The shop grids' scroll wheel (a NovaJS Enhancement, "Scroll wheel in
// shops"): turns wheel events over the outfitter, shipyard and hire grids
// into whole-row scroll steps. Pure, so the mapping is unit tested
// (grid_wheel_test.ts); item_grid.ts binds it to PIXI's wheel event.
//
// The original's grids scroll only by their arrow buttons (a page at a
// time) and the keyboard; the wheel does nothing there.
import {
    DOM_DELTA_LINE, DOM_DELTA_PAGE, LINE_PX, PAGE_PX, WheelMapper,
    WheelSample,
} from './starmap_gestures.js';

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
