// The starmap's pointer input: one interactive area over the whole map
// pane that turns raw pointer/wheel/gesture events into pans, zooms and
// taps. The click-vs-drag decision itself is the pure DragTracker
// (starmap_hit.ts); the wheel/pinch mapping and unit conversions are the
// pure helpers in starmap_gestures.ts.
import * as PIXI from 'pixi.js';
import { DragTracker } from "./starmap_hit.js";
import {
    globalDeltaToLocal, globalPerCssPx, PinchGesture, WheelMapper,
} from "./starmap_gestures.js";

/** What a bound map pane reports, in the pane's own coordinates. */
export interface MapPointerHandlers {
    /** The pointer dragged (or a trackpad scrolled) the map by a delta in
     * pane-local units. */
    pan(dx: number, dy: number): void;
    /** The wheel or a pinch zoomed by `factor` around the pane-local point
     * (x, y). `notched`: one detent of a classic wheel; false for a pinch's
     * continuous share. */
    zoomAt(factor: number, x: number, y: number, notched: boolean): void;
    /** A click (not the end of a drag) at the pane-local point (x, y). */
    tap(x: number, y: number, shiftKey: boolean): void;
    /** A gesture became a drag; (x, y) is where it was pressed, pane-local.
     * Once per gesture, before its first `pan`. */
    dragStart?(x: number, y: number): void;
    /** A view that never pans or zooms (the `h` minimap): wheel and pinch
     * events over it are left to the page instead of being claimed. */
    fixed?: boolean;
}

/** The map pane the pointer is over, for Safari's gesture events (which
 * PIXI does not route): where it is, pane-local, and who to tell. */
interface HoveredPane {
    container: PIXI.Container;
    x: number;
    y: number;
    zoomAt: MapPointerHandlers['zoomAt'];
    /** {@link pointerMoves} when this was recorded. */
    seq: number;
}
let hoveredPane: HoveredPane | undefined;
/**
 * Counts the page's pointer moves (a window capture listener, so it runs
 * before PIXI's). A pane's record is only current while no move has
 * happened since it was taken, i.e. while the pointer's last move was
 * over that pane: a pointer that left for the status bar, or a map that
 * was closed or rebuilt under it, does not leave a stale target behind.
 */
let pointerMoves = 0;
/** Native wheel events a map pane has acted on, for the page-level
 * listener below to cancel. */
const claimedWheels = new WeakSet<Event>();
const pinch = new PinchGesture();
let pageListenersInstalled = false;

/** The hovered pane, if it is still on screen. */
function livePane(): HoveredPane | undefined {
    const pane = hoveredPane;
    if (!pane || pane.seq !== pointerMoves || pane.container.destroyed
        || !pane.container.worldVisible) {
        return undefined;
    }
    return pane;
}

/**
 * Page-level listeners, installed once: PIXI listens to `wheel` PASSIVELY,
 * so a map pane cannot cancel the browser's own reaction (ctrl+wheel is
 * the browser's page zoom, which a trackpad pinch arrives as) from its
 * PIXI handler. This non-passive listener runs after PIXI's (the event
 * bubbles up to `window` from the canvas) and cancels the events a pane
 * claimed. Safari reports a pinch as `gesture*` events instead, which
 * PIXI does not route at all; those zoom the hovered pane here.
 */
function installPageListeners() {
    if (pageListenersInstalled || typeof window === 'undefined'
        || typeof window.addEventListener !== 'function') {
        return;
    }
    pageListenersInstalled = true;
    window.addEventListener('pointermove', () => {
        pointerMoves++;
    }, { capture: true, passive: true });
    window.addEventListener('wheel', event => {
        if (claimedWheels.has(event)) {
            event.preventDefault();
        }
    }, { passive: false });
    window.addEventListener('gesturestart', event => {
        if (livePane()) {
            event.preventDefault();
            pinch.start();
        }
    }, { passive: false });
    window.addEventListener('gesturechange', event => {
        const pane = livePane();
        if (!pane || !pinch.active) {
            return;
        }
        event.preventDefault();
        const factor = pinch.change((event as Event & { scale: number }).scale);
        if (factor !== 1) {
            pane.zoomAt(factor, pane.x, pane.y, false);
        }
    }, { passive: false });
    window.addEventListener('gestureend', event => {
        if (pinch.active) {
            event.preventDefault();
            pinch.end();
        }
    }, { passive: false });
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
    const wheel = new WheelMapper();
    /** Renderer px per CSS px, from the last wheel event (see
     * globalPerCssPx). */
    let globalPerCss = 1;
    installPageListeners();
    /** The current gesture's press point, pane-local, until it is reported
     * as a drag. */
    let pressedAt: { x: number, y: number } | undefined;

    container.eventMode = 'static';
    container.hitArea = new PIXI.Rectangle(0, 0, size.x, size.y);
    container.cursor = 'pointer';

    const onDragStart = (event: PIXI.FederatedPointerEvent) => {
        drag.down(event.pointerId, event.global.x, event.global.y);
        const local = event.getLocalPosition(container);
        pressedAt = { x: local.x, y: local.y };
    };
    const onDragMove = (event: PIXI.FederatedPointerEvent) => {
        const delta = drag.move(event.pointerId, event.global.x, event.global.y);
        if (delta) {
            if (pressedAt) {
                const { x, y } = pressedAt;
                pressedAt = undefined;
                handlers.dragStart?.(x, y);
            }
            // The tracker works in renderer px (its deadzone is a screen
            // distance); the pane is scaled by the UI layer above it.
            const local = globalDeltaToLocal(container.worldTransform,
                delta.dx, delta.dy);
            handlers.pan(local.dx, local.dy);
        }
        if (!handlers.fixed) {
            const local = event.getLocalPosition(container);
            hoveredPane = { container, x: local.x, y: local.y,
                zoomAt: handlers.zoomAt, seq: pointerMoves };
        }
    };
    const onOut = () => {
        if (hoveredPane?.container === container) {
            hoveredPane = undefined;
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
        if (handlers.fixed) {
            return;
        }
        const native = event.nativeEvent as WheelEvent & {
            wheelDeltaY?: number };
        if (pinch.active && event.ctrlKey) {
            // Safari may report its pinch both ways; the gesture events
            // already zoom.
            claimedWheels.add(native);
            return;
        }
        const action = wheel.action({
            deltaX: event.deltaX, deltaY: event.deltaY,
            deltaMode: event.deltaMode, ctrlKey: event.ctrlKey,
            wheelDeltaY: typeof native?.wheelDeltaY === 'number'
                ? native.wheelDeltaY : undefined,
            timeStamp: event.timeStamp,
        });
        if (action.kind === 'none') {
            return;
        }
        claimedWheels.add(native);
        const local = event.getLocalPosition(container);
        hoveredPane = { container, x: local.x, y: local.y,
            zoomAt: handlers.zoomAt, seq: pointerMoves };
        if (action.kind === 'zoom') {
            handlers.zoomAt(action.factor, local.x, local.y, action.notched);
            return;
        }
        // Deltas are CSS px; the content moves exactly as far on screen.
        const rect = (native?.target as Element | null)
            ?.getBoundingClientRect?.();
        if (rect) {
            globalPerCss = globalPerCssPx(event.global.x, event.global.y,
                event.client.x - rect.left, event.client.y - rect.top,
                globalPerCss);
        }
        const delta = globalDeltaToLocal(container.worldTransform,
            action.dx * globalPerCss, action.dy * globalPerCss);
        handlers.pan(delta.dx, delta.dy);
    };
    container
        .on('pointerdown', onDragStart)
        .on('pointerup', onDragEnd)
        .on('pointerupoutside', onDragEnd)
        .on('pointermove', onDragMove)
        .on('pointerout', onOut)
        .on('pointertap', onTap)
        .on('wheel', onWheel);
}
