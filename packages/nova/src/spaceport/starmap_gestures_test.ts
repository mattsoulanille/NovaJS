import "jasmine";
import * as PIXI from 'pixi.js';
import { globalDeltaToLocal } from "./starmap_gestures.js";
import { installHeadlessPixi } from "./headless_pixi_fixture.js";
import { MapViewport } from "./starmap_viewport.js";

/** `c`'s world transform, brought up to date (toGlobal walks the
 * ancestors and refreshes each). */
function worldOf(c: PIXI.Container): PIXI.Matrix {
    c.toGlobal(new PIXI.Point());
    return c.worldTransform;
}

const identity = { a: 1, b: 0, c: 0, d: 1 };

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
