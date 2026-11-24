import 'jasmine';
import { overrideEnhancements } from '../enhancements.js';
import { GRID_ROW_PX, WheelRowStepper } from './grid_wheel.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { ItemGrid } from './item_grid.js';
import {
    DOM_DELTA_LINE, DOM_DELTA_PIXEL, MAC_WHEEL_NOTCH, TRACKPAD_LATCH_MS,
    WheelSample,
} from './starmap_gestures.js';

function sample(deltaY: number, timeStamp: number,
    extra: Partial<WheelSample> = {}): WheelSample {
    return { deltaX: 0, deltaY, deltaMode: DOM_DELTA_PIXEL, ctrlKey: false,
        timeStamp, ...extra };
}

describe('WheelRowStepper (shop grid wheel)', () => {
    it('scrolls one row per notch of a classic wheel, either way', () => {
        const stepper = new WheelRowStepper();
        expect(stepper.rows(sample(MAC_WHEEL_NOTCH * 3, 0))).toBe(1);
        expect(stepper.rows(sample(-MAC_WHEEL_NOTCH, 1000))).toBe(-1);
        // Firefox reports wheels in lines: still one row per event.
        expect(stepper.rows(sample(3, 2000,
            { deltaMode: DOM_DELTA_LINE }))).toBe(1);
    });

    it('accumulates a trackpad scroll into rows, carrying the rest', () => {
        const stepper = new WheelRowStepper();
        let t = 0;
        const step = (dy: number) => stepper.rows(sample(dy, t += 16));
        expect(step(GRID_ROW_PX / 2 + 0.3)).toBe(0);
        expect(step(GRID_ROW_PX / 2 + 0.3)).toBe(1);
        expect(step(GRID_ROW_PX * 2 + 0.5)).toBe(2);
        // A fling.
        expect(step(GRID_ROW_PX * 3.5)).toBe(3);
    });

    it('drops the carry when the scroll reverses', () => {
        const stepper = new WheelRowStepper();
        expect(stepper.rows(sample(GRID_ROW_PX * 0.9 + 0.1, 0))).toBe(0);
        // Without the reset this would cancel against the 0.9 row carried.
        expect(stepper.rows(sample(-(GRID_ROW_PX + 0.1), 16))).toBe(-1);
    });

    it('ignores a pinch and a sideways-only scroll', () => {
        const stepper = new WheelRowStepper();
        expect(stepper.rows(sample(-80.5, 0, { ctrlKey: true }))).toBe(0);
        expect(stepper.rows(sample(0, 16, { deltaX: 40 }))).toBe(0);
    });

    it('keeps a notch-sized delta mid-gesture a trackpad delta', () => {
        const stepper = new WheelRowStepper();
        expect(stepper.rows(sample(3.3, 0))).toBe(0);
        // Looks like a detent, but comes inside the trackpad latch.
        expect(stepper.rows(sample(MAC_WHEEL_NOTCH,
            TRACKPAD_LATCH_MS / 2))).toBe(0);
    });
});

describe('ItemGrid scroll wheel ("Scroll wheel in shops")', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => overrideEnhancements({}));

    /** 37 items: ten rows of four, the last partly filled; the page shows
     * five, so the furthest the grid scrolls is row 5. */
    function grid() {
        const items = Array.from({ length: 37 }, (_, i) => ({
            id: `item:${i}`, name: `Item ${i}`, desc: '', pict: '',
        }));
        return new ItemGrid(undefined as never, items);
    }
    const notch = (down: boolean, t: number) =>
        sample(down ? MAC_WHEEL_NOTCH : -MAC_WHEEL_NOTCH, t * 1000);

    it('moves the page by rows with the enhancement on (the default)', () => {
        const g = grid();
        let scrolled = 0;
        g.scrolled.subscribe(() => scrolled++);
        g.onWheel(notch(true, 1));
        g.onWheel(notch(true, 2));
        expect(g.scrollRow).toBe(2);
        expect(g.canScrollUp).toBeTrue();
        expect(scrolled).toBe(2);
        g.onWheel(notch(false, 3));
        expect(g.scrollRow).toBe(1);
    });

    it('stops at either end without firing', () => {
        const g = grid();
        let scrolled = 0;
        g.scrolled.subscribe(() => scrolled++);
        g.onWheel(notch(false, 1));
        expect(g.scrollRow).toBe(0);
        expect(scrolled).toBe(0);
        for (let i = 0; i < 20; i++) {
            g.onWheel(notch(true, i + 2));
        }
        expect(g.scrollRow).toBe(5);
        expect(g.canScrollDown).toBeFalse();
        expect(scrolled).toBe(5);
    });

    it('leaves the selection alone', () => {
        const g = grid();
        g.right();
        const selected = g.selection;
        g.onWheel(notch(true, 1));
        expect(g.selection).toBe(selected);
    });

    it('does nothing with the enhancement off (the original)', () => {
        overrideEnhancements({ enhShopScrollWheel: false });
        const g = grid();
        let scrolled = 0;
        g.scrolled.subscribe(() => scrolled++);
        g.onWheel(notch(true, 1));
        g.onWheel(sample(GRID_ROW_PX * 3, 5000));
        expect(g.scrollRow).toBe(0);
        expect(scrolled).toBe(0);
        // The arrows still work.
        g.scrollDown();
        expect(g.scrollRow).toBe(5);
    });
});
