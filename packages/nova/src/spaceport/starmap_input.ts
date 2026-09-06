// The starmap's pointer input: one interactive area over the whole map
// pane that turns raw pointer/wheel events into pans, zooms and taps. The
// click-vs-drag decision itself is the pure DragTracker (starmap_hit.ts).
import * as PIXI from 'pixi.js';
import { DragTracker } from "./starmap_hit.js";
import { ZOOM_STEP } from "./starmap_viewport.js";

/** What a bound map pane reports, in the pane's own coordinates. */
export interface MapPointerHandlers {
    /** The pointer dragged the map by a screen-space delta. */
    pan(dx: number, dy: number): void;
    /** The wheel zoomed by `factor` around the pane-local point (x, y). */
    zoomAt(factor: number, x: number, y: number): void;
    /** A click (not the end of a drag) at the pane-local point (x, y). */
    tap(x: number, y: number, shiftKey: boolean): void;
}

/**
 * Captures pointer and wheel events over the whole map area. Clicks on
 * systems are resolved by the caller's `tap` handler by finding the nearest
 * system to the pointer: with one interactive object instead of hundreds,
 * the event system stays fast, and a label drawn over a neighboring system
 * (e.g. Murasaki's label over Fomalhaut) can't swallow that system's
 * clicks like per-circle hit-testing allowed.
 */
export function bindMapPointer(container: PIXI.Container,
    size: { x: number, y: number }, handlers: MapPointerHandlers) {
    // The click-vs-drag state machine (starmap_hit.ts). Decides when a pointer
    // gesture has moved far enough to be a pan rather than a click, so the tap
    // handler can tell a click apart from the end of a pan. A physical click
    // jitters a pixel or two between press and release; treating that as a
    // drag used to swallow the tap (click once, nothing; click again without
    // moving, it registers), which the tracker's deadzone fixes.
    const drag = new DragTracker();

    container.eventMode = 'static';
    container.hitArea = new PIXI.Rectangle(0, 0, size.x, size.y);
    container.cursor = 'pointer';

    const onDragStart = (event: PIXI.FederatedPointerEvent) => {
        drag.down(event.pointerId, event.global.x, event.global.y);
    };
    const onDragMove = (event: PIXI.FederatedPointerEvent) => {
        const delta = drag.move(event.pointerId, event.global.x, event.global.y);
        if (delta) {
            handlers.pan(delta.dx, delta.dy);
        }
    };
    const onDragEnd = (event: PIXI.FederatedPointerEvent) => {
        // The tracker keeps its `dragged` flag set until the next pointerdown
        // so onTap (which fires right after pointerup) can tell a click apart
        // from the end of a pan.
        drag.up(event.pointerId);
    };
    const onTap = (event: PIXI.FederatedPointerEvent) => {
        // Ignore taps that were actually the end of a drag.
        if (drag.dragged) {
            return;
        }
        const local = event.getLocalPosition(container);
        handlers.tap(local.x, local.y, event.shiftKey);
    };
    const onWheel = (event: PIXI.FederatedWheelEvent) => {
        const local = event.getLocalPosition(container);
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        handlers.zoomAt(factor, local.x, local.y);
    };
    container
        .on('pointerdown', onDragStart)
        .on('pointerup', onDragEnd)
        .on('pointerupoutside', onDragEnd)
        .on('pointermove', onDragMove)
        .on('pointertap', onTap)
        .on('wheel', onWheel);
}
