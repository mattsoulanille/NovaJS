import "jasmine";
import {
    DOM_DELTA_LINE, DOM_DELTA_PAGE, globalDeltaToLocal, globalPerCssPx,
    LINE_PX, looksNotched, MAC_WHEEL_NOTCH, PAGE_PX, PinchGesture,
    PINCH_ZOOM_RATE, TRACKPAD_LATCH_MS, WheelMapper, WheelSample,
} from "./starmap_gestures.js";
import { installHeadlessPixi } from "./headless_pixi_fixture.js";
import { MapViewport, ZOOM_STEP } from "./starmap_viewport.js";
import * as PIXI from 'pixi.js';

/** `c`'s world transform, brought up to date (toGlobal walks the
 * ancestors and refreshes each). */
function worldOf(c: PIXI.Container): PIXI.Matrix {
    c.toGlobal(new PIXI.Point());
    return c.worldTransform;
}

const identity = { a: 1, b: 0, c: 0, d: 1 };

function sample(over: Partial<WheelSample>): WheelSample {
    return {
        deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, timeStamp: 0,
        ...over,
    };
}

describe('globalDeltaToLocal (drag deltas into the pane\'s units)', () => {
    beforeAll(() => installHeadlessPixi());

    it('passes a delta through an unscaled pane unchanged', () => {
        expect(globalDeltaToLocal(identity, 12, -7)).toEqual({ dx: 12, dy: -7 });
    });

    it('divides out the UI scale the pane is drawn at', () => {
        // The regression: the map pane sits in the UI layer (scaled by the
        // player's UI scale) but panned by the raw renderer delta, so at
        // 1.25 the map ran 25 % ahead of the mouse.
        const m = { a: 1.25, b: 0, c: 0, d: 1.25 };
        const local = globalDeltaToLocal(m, 100, -50);
        expect(local.dx).toBeCloseTo(80, 9);
        expect(local.dy).toBeCloseTo(-40, 9);
        // ...so the pane-local pan, drawn at 1.25, is exactly the mouse's.
        expect(local.dx * 1.25).toBeCloseTo(100, 9);
        expect(local.dy * 1.25).toBeCloseTo(-50, 9);
    });

    it('inverts a non-uniform or rotated linear transform', () => {
        const angle = 0.3;
        const m = {
            a: 2 * Math.cos(angle), b: 2 * Math.sin(angle),
            c: -1.5 * Math.sin(angle), d: 1.5 * Math.cos(angle),
        };
        const local = globalDeltaToLocal(m, 10, 4);
        // Forward-map the local delta and get the global one back.
        expect(m.a * local.dx + m.c * local.dy).toBeCloseTo(10, 9);
        expect(m.b * local.dx + m.d * local.dy).toBeCloseTo(4, 9);
    });

    it('agrees with PIXI.Container.toLocal for a scaled, offset pane', () => {
        const ui = new PIXI.Container();
        ui.scale.set(1.5);
        const pane = new PIXI.Container();
        pane.position.set(-290, -248);
        ui.position.set(640, 400);
        ui.addChild(pane);
        const a = pane.toLocal(new PIXI.Point(300, 200));
        const b = pane.toLocal(new PIXI.Point(345, 170));
        const local = globalDeltaToLocal(worldOf(pane), 45, -30);
        expect(local.dx).toBeCloseTo(b.x - a.x, 9);
        expect(local.dy).toBeCloseTo(b.y - a.y, 9);
    });

    it('leaves a delta alone rather than divide by a singular transform', () => {
        expect(globalDeltaToLocal({ a: 0, b: 0, c: 0, d: 0 }, 3, 4))
            .toEqual({ dx: 3, dy: 4 });
    });

    it('keeps a dragged dot under the cursor at every zoom and UI scale', () => {
        for (const uiScale of [1, 1.25, 2]) {
            for (const zoom of [0.3, 0.885, 2, 4]) {
                const root = new PIXI.Container();
                root.scale.set(uiScale);
                const pane = new PIXI.Container();
                root.addChild(pane);
                const viewport = new MapViewport(pane, { x: 600, y: 500 },
                    { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 });
                viewport.zoomBy(zoom);
                const dot = new PIXI.Point(37, -12);
                const before = viewport.mapContainer.toGlobal(dot);
                // The mouse moves (55, -21) renderer px.
                const delta = globalDeltaToLocal(worldOf(pane), 55, -21);
                viewport.pan(delta.dx, delta.dy);
                const after = viewport.mapContainer.toGlobal(dot);
                expect(after.x - before.x).toBeCloseTo(55, 6);
                expect(after.y - before.y).toBeCloseTo(-21, 6);
            }
        }
    });
});

describe('globalPerCssPx', () => {
    it('reads renderer px per CSS px off one event position', () => {
        // Global scale 1.5: 300 CSS px from the canvas edge is 200 px.
        expect(globalPerCssPx(200, 100, 300, 150)).toBeCloseTo(2 / 3, 9);
    });

    it('uses the axis farther from the canvas origin', () => {
        expect(globalPerCssPx(0.5, 400, 0.5, 800)).toBeCloseTo(0.5, 9);
    });

    it('falls back when the point is at the canvas origin', () => {
        expect(globalPerCssPx(0, 0, 0, 0, 0.8)).toBe(0.8);
    });
});

describe('looksNotched (classic wheel vs trackpad)', () => {
    it('reads line- and page-mode deltas as a wheel (Firefox mice)', () => {
        expect(looksNotched(sample({ deltaY: 3, deltaMode: DOM_DELTA_LINE })))
            .toBeTrue();
        expect(looksNotched(sample({ deltaY: 1, deltaMode: DOM_DELTA_PAGE })))
            .toBeTrue();
    });

    it('reads multiples of the macOS detent as a wheel (Chrome/Safari)', () => {
        expect(looksNotched(sample({ deltaY: MAC_WHEEL_NOTCH }))).toBeTrue();
        expect(looksNotched(sample({ deltaY: -3 * MAC_WHEEL_NOTCH })))
            .toBeTrue();
    });

    it('reads a 120-per-detent legacy delta with a large deltaY as a wheel', () => {
        expect(looksNotched(sample({ deltaY: 100, wheelDeltaY: -120 })))
            .toBeTrue();
        expect(looksNotched(sample({ deltaY: -125, wheelDeltaY: 120 })))
            .toBeTrue();
    });

    it('reads fractional, small or two-axis pixel deltas as a trackpad', () => {
        expect(looksNotched(sample({ deltaY: 2.5 }))).toBeFalse();
        expect(looksNotched(sample({ deltaY: -40, wheelDeltaY: 120 })))
            .toBeFalse();
        expect(looksNotched(sample({ deltaX: 1, deltaY: 100 }))).toBeFalse();
        expect(looksNotched(sample({ deltaY: 7 }))).toBeFalse();
    });
});

describe('WheelMapper (wheel events to map actions)', () => {
    it('keeps a notched wheel at one zoom step per event, in for deltaY < 0', () => {
        const mapper = new WheelMapper();
        expect(mapper.action(sample({ deltaY: -3, deltaMode: DOM_DELTA_LINE })))
            .toEqual({ kind: 'zoom', factor: ZOOM_STEP, notched: true });
        expect(mapper.action(sample({ deltaY: MAC_WHEEL_NOTCH, timeStamp: 500 })))
            .toEqual({ kind: 'zoom', factor: 1 / ZOOM_STEP, notched: true });
    });

    it('steps a notched wheel the same with ctrl held', () => {
        const mapper = new WheelMapper();
        expect(mapper.action(sample({
            deltaY: -100, wheelDeltaY: 120, ctrlKey: true,
        }))).toEqual({ kind: 'zoom', factor: ZOOM_STEP, notched: true });
    });

    it('pans sideways for a tilt-wheel notch', () => {
        const mapper = new WheelMapper();
        expect(mapper.action(sample({ deltaX: 2, deltaMode: DOM_DELTA_LINE })))
            .toEqual({ kind: 'pan', dx: -2 * LINE_PX, dy: 0 });
        expect(mapper.action(sample({ deltaX: -1, deltaMode: DOM_DELTA_PAGE })))
            .toEqual({ kind: 'pan', dx: PAGE_PX, dy: 0 });
    });

    it('pans a two-finger scroll by the deltas, content following the fingers', () => {
        const mapper = new WheelMapper();
        expect(mapper.action(sample({ deltaX: 3.5, deltaY: -2.25 })))
            .toEqual({ kind: 'pan', dx: -3.5, dy: 2.25 });
        expect(mapper.action(sample({ deltaX: -6, deltaY: 0, timeStamp: 16 })))
            .toEqual({ kind: 'pan', dx: 6, dy: 0 });
    });

    it('zooms a pinch (ctrl+wheel, pixel deltas) continuously', () => {
        const mapper = new WheelMapper();
        const inward = mapper.action(sample({ deltaY: -4.3, ctrlKey: true }));
        expect(inward.kind).toBe('zoom');
        // Not a detent: the original-zoom mode steps it by accumulation.
        expect((inward as { notched: boolean }).notched).toBeFalse();
        expect((inward as { factor: number }).factor)
            .toBeCloseTo(Math.exp(4.3 * PINCH_ZOOM_RATE), 12);
        const outward = mapper.action(sample({
            deltaY: 6.1, ctrlKey: true, timeStamp: 16,
        }));
        expect((outward as { factor: number }).factor)
            .toBeCloseTo(Math.exp(-6.1 * PINCH_ZOOM_RATE), 12);
        // Pinching out by d then in by d lands back where it started.
        const a = mapper.action(sample({ deltaY: 5, ctrlKey: true, timeStamp: 32 }));
        const b = mapper.action(sample({ deltaY: -5, ctrlKey: true, timeStamp: 48 }));
        expect((a as { factor: number }).factor
            * (b as { factor: number }).factor).toBeCloseTo(1, 12);
    });

    it('does not read a notch-like delta mid-trackpad-gesture as a wheel', () => {
        const mapper = new WheelMapper();
        mapper.action(sample({ deltaY: 2.5, timeStamp: 1000 }));
        // 16 ms later the trackpad happens to report exactly one detent.
        expect(mapper.action(sample({ deltaY: MAC_WHEEL_NOTCH, timeStamp: 1016 })))
            .toEqual({ kind: 'pan', dx: 0, dy: -MAC_WHEEL_NOTCH });
        // Long after the gesture, the same delta is a wheel again.
        expect(mapper.action(sample({
            deltaY: MAC_WHEEL_NOTCH, timeStamp: 1016 + TRACKPAD_LATCH_MS + 1,
        }))).toEqual({ kind: 'zoom', factor: 1 / ZOOM_STEP, notched: true });
    });

    it('never reads line-mode deltas as a trackpad, even mid-gesture', () => {
        const mapper = new WheelMapper();
        mapper.action(sample({ deltaY: 2.5, timeStamp: 1000 }));
        expect(mapper.action(sample({
            deltaY: -3, deltaMode: DOM_DELTA_LINE, timeStamp: 1010,
        }))).toEqual({ kind: 'zoom', factor: ZOOM_STEP, notched: true });
    });

    it('does nothing for an empty delta', () => {
        const mapper = new WheelMapper();
        expect(mapper.action(sample({}))).toEqual({ kind: 'none' });
        expect(mapper.action(sample({ ctrlKey: true, deltaX: 3 })))
            .toEqual({ kind: 'none' });
    });
});

describe('PinchGesture (Safari gesture events)', () => {
    it('turns the cumulative scale into per-change factors', () => {
        const pinch = new PinchGesture();
        expect(pinch.active).toBeFalse();
        pinch.start();
        expect(pinch.active).toBeTrue();
        expect(pinch.change(1.2)).toBeCloseTo(1.2, 12);
        expect(pinch.change(1.5)).toBeCloseTo(1.25, 12);
        expect(pinch.change(0.75)).toBeCloseTo(0.5, 12);
        pinch.end();
        expect(pinch.active).toBeFalse();
    });

    it('ignores changes outside a gesture and nonsense scales', () => {
        const pinch = new PinchGesture();
        expect(pinch.change(2)).toBe(1);
        pinch.start();
        expect(pinch.change(0)).toBe(1);
        expect(pinch.change(NaN)).toBe(1);
        expect(pinch.change(2)).toBe(2);
    });
});

describe('MapViewport.zoomBy about a point (pinch anchor)', () => {
    beforeAll(() => installHeadlessPixi());

    it('keeps the world point under the cursor fixed through a pinch', () => {
        const root = new PIXI.Container();
        const viewport = new MapViewport(root, { x: 600, y: 500 },
            { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 });
        viewport.zoomBy(0.885);
        const cursor = new PIXI.Point(180, 330);
        const world = viewport.mapContainer.toLocal(cursor);
        for (const factor of [1.04, 1.07, 0.9, 0.95, 1.3]) {
            viewport.zoomBy(factor, cursor.x, cursor.y);
            const back = viewport.mapContainer.toGlobal(world);
            expect(back.x).toBeCloseTo(cursor.x, 6);
            expect(back.y).toBeCloseTo(cursor.y, 6);
        }
    });
});
