// Pure gesture math for the map pane (starmap_input.ts binds it to PIXI
// and the DOM): converting pointer deltas into the pane's own units, and
// turning wheel / Safari gesture events into pans and zooms. Free of PIXI
// and the DOM so the mapping can be unit tested (starmap_gestures_test.ts).
import { ZOOM_STEP } from "./starmap_viewport.js";

/** The linear part of a 2D affine transform (PIXI.Matrix's a, b, c, d). */
export interface LinearTransform {
    a: number, b: number, c: number, d: number,
}

/**
 * A delta in renderer (PIXI "global") units, expressed in the local units
 * of a container whose world transform is `m`.
 *
 * The map pane sits inside layers PIXI scales (the UI layer carries the
 * player's UI scale), so a pointer that moved N global px moved N / scale
 * of the pane's own px. Panning the map by the raw global delta moved the
 * map `scale` times faster than the mouse (Matthew, 2026-11-23: "panning
 * moves a bit faster than the mouse" — at UI scale 1.25, 25 % faster).
 * Only the linear part matters for a delta; translation cancels.
 */
export function globalDeltaToLocal(m: LinearTransform, dx: number,
    dy: number): { dx: number, dy: number } {
    const det = m.a * m.d - m.b * m.c;
    if (det === 0 || !Number.isFinite(det)) {
        return { dx, dy };
    }
    return {
        dx: (m.d * dx - m.c * dy) / det,
        dy: (m.a * dy - m.b * dx) / det,
    };
}

/**
 * Renderer (global) units per CSS pixel, from one event's position: PIXI
 * maps a client point to `global = (client - canvasOrigin) * k`, so `k`
 * is `global / (client - canvasOrigin)` on either axis. Wheel deltas
 * arrive in CSS px and have to go through the same `k` to land where the
 * fingers are. Returns `fallback` when the point is too close to the
 * canvas origin to divide by.
 */
export function globalPerCssPx(globalX: number, globalY: number,
    offsetX: number, offsetY: number, fallback = 1): number {
    if (Math.abs(offsetX) >= Math.abs(offsetY) && Math.abs(offsetX) > 1) {
        return globalX / offsetX;
    }
    if (Math.abs(offsetY) > 1) {
        return globalY / offsetY;
    }
    return fallback;
}

// WheelEvent.deltaMode values (the DOM constants, without needing a DOM).
export const DOM_DELTA_PIXEL = 0;
export const DOM_DELTA_LINE = 1;
export const DOM_DELTA_PAGE = 2;

/**
 * What one detent of a classic mouse wheel reports in Chrome and Safari on
 * macOS: deltaY is always a multiple of this (the same constant Mapbox GL
 * keys its wheel/trackpad split on). Trackpads report arbitrary values.
 */
export const MAC_WHEEL_NOTCH = 4.000244140625;
/** Smallest |deltaY| a Windows/Linux Chromium notch reports (100 per
 * detent at 100 % display scaling; more at higher scaling). */
const MIN_PIXEL_NOTCH = 50;
/**
 * How long after a trackpad-looking event later ones are still read as
 * the same trackpad gesture. A trackpad scroll (and its momentum tail)
 * sends events every ~16 ms, so a delta that happens to look like a notch
 * mid-gesture is not taken for one and turned into a zoom step.
 */
export const TRACKPAD_LATCH_MS = 300;
/**
 * Continuous pinch zoom: a ctrl+wheel deltaY of -100 zooms by e (about
 * what a full pinch reports in Chrome, whose pinch deltas are
 * `-(scale - 1) * 100` per event).
 */
export const PINCH_ZOOM_RATE = 0.01;
/** CSS px one wheel "line" pans when a notched wheel is tilted sideways. */
export const LINE_PX = 40;
/** CSS px one wheel "page" pans, likewise. */
export const PAGE_PX = 400;

/** The parts of a WheelEvent the map's mapping reads. */
export interface WheelSample {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    ctrlKey: boolean;
    /** The legacy `wheelDeltaY` (Chromium/WebKit), when the browser has it:
     * a multiple of 120 per detent for a mouse wheel. */
    wheelDeltaY?: number;
    /** Event time in ms (any monotonic clock). */
    timeStamp: number;
}

/** What a wheel event does to the map. */
export type MapWheelAction =
    /** Move the map content by (dx, dy) CSS px. */
    | { kind: 'pan', dx: number, dy: number }
    /** Zoom by `factor` about the pointer. `notched`: one detent of a
     * classic wheel (one level of the original's stepped zoom), not a
     * pinch's continuous share. */
    | { kind: 'zoom', factor: number, notched: boolean }
    | { kind: 'none' };

/** Whether a sample, on its own, looks like a detent of a classic wheel. */
export function looksNotched(sample: WheelSample): boolean {
    if (sample.deltaMode !== DOM_DELTA_PIXEL) {
        // Firefox reports mouse wheels in lines; trackpads in pixels.
        return true;
    }
    if (sample.deltaX !== 0 || sample.deltaY === 0) {
        return false;
    }
    const remainder = Math.abs(sample.deltaY) % MAC_WHEEL_NOTCH;
    if (remainder < 1e-6 || MAC_WHEEL_NOTCH - remainder < 1e-6) {
        return true;
    }
    const legacy = sample.wheelDeltaY;
    return legacy !== undefined && legacy !== 0 && legacy % 120 === 0
        && Math.abs(sample.deltaY) >= MIN_PIXEL_NOTCH;
}

/**
 * Turns wheel events into map actions, remembering just enough between
 * events to keep a trackpad gesture from being misread as a wheel.
 *
 * - A classic notched wheel keeps today's behaviour: one zoom step
 *   ({@link ZOOM_STEP}) per event, in when deltaY < 0, about the pointer —
 *   with or without ctrl. A tilt (horizontal-only) notch pans sideways.
 * - A trackpad's two-finger scroll (pixel deltas, ctrl up) pans the map by
 *   the deltas, content following the fingers: (-deltaX, -deltaY).
 * - A pinch (ctrl+wheel with pixel deltas, how Chrome/Firefox/Edge report
 *   it) zooms continuously by exp(-deltaY * {@link PINCH_ZOOM_RATE}).
 */
export class WheelMapper {
    private lastTrackpadAt = -Infinity;

    /** Whether this event comes from a classic notched wheel. */
    isNotched(sample: WheelSample): boolean {
        // Line/page deltas only ever come from a wheel, latch or not.
        const latched = sample.deltaMode === DOM_DELTA_PIXEL
            && sample.timeStamp - this.lastTrackpadAt < TRACKPAD_LATCH_MS;
        const notched = !latched && looksNotched(sample);
        if (!notched) {
            this.lastTrackpadAt = sample.timeStamp;
        }
        return notched;
    }

    action(sample: WheelSample): MapWheelAction {
        if (this.isNotched(sample)) {
            if (sample.deltaY !== 0) {
                return {
                    kind: 'zoom',
                    factor: sample.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
                    notched: true,
                };
            }
            if (sample.deltaX !== 0) {
                const unit = sample.deltaMode === DOM_DELTA_LINE ? LINE_PX
                    : sample.deltaMode === DOM_DELTA_PAGE ? PAGE_PX : 1;
                return { kind: 'pan', dx: -sample.deltaX * unit, dy: 0 };
            }
            return { kind: 'none' };
        }
        if (sample.ctrlKey) {
            if (sample.deltaY === 0) {
                return { kind: 'none' };
            }
            return {
                kind: 'zoom',
                factor: Math.exp(-sample.deltaY * PINCH_ZOOM_RATE),
                notched: false,
            };
        }
        if (sample.deltaX === 0 && sample.deltaY === 0) {
            return { kind: 'none' };
        }
        // `|| 0`: no negative zeros for a still axis.
        return { kind: 'pan', dx: -sample.deltaX || 0, dy: -sample.deltaY || 0 };
    }
}

/** How far apart the original's seven map zoom levels are: x 4/3 each
 * (42.1, 56.2, 75, 100, 133.3, 177.7, 237 %; starmap_viewport.ts
 * ORIGINAL_MAP_SCALES). */
export const ORIGINAL_LEVEL_RATIO = 4 / 3;

/**
 * Turns a pinch's continuous zoom factors into whole level steps for the
 * original's stepped zoom (the "Smooth map zoom" enhancement off): a step
 * each time the pinch has zoomed by one level's ratio
 * ({@link ORIGINAL_LEVEL_RATIO}) the same way. Reversing the pinch drops
 * whatever was left over the old way.
 */
export class PinchLevelStepper {
    private accumulated = 0;

    /** The whole levels to step for one more pinch `factor` (+ in, - out;
     * usually 0). */
    steps(factor: number): number {
        const log = Math.log(factor);
        if (!Number.isFinite(log) || log === 0) {
            return 0;
        }
        if (this.accumulated !== 0
            && Math.sign(log) !== Math.sign(this.accumulated)) {
            this.accumulated = 0;
        }
        this.accumulated += log;
        const level = Math.log(ORIGINAL_LEVEL_RATIO);
        const steps = Math.trunc(this.accumulated / level);
        this.accumulated -= steps * level;
        return steps;
    }
}

/**
 * Safari's pinch: `gesturestart` / `gesturechange` / `gestureend` carry a
 * `scale` cumulative since the gesture began. Hands back the incremental
 * zoom factor for each change.
 */
export class PinchGesture {
    private lastScale: number | undefined;

    get active(): boolean {
        return this.lastScale !== undefined;
    }

    start() {
        this.lastScale = 1;
    }

    /** The zoom factor since the previous change, or 1 if there is none. */
    change(scale: number): number {
        if (this.lastScale === undefined || !(scale > 0)
            || !Number.isFinite(scale)) {
            return 1;
        }
        const factor = scale / this.lastScale;
        this.lastScale = scale;
        return factor;
    }

    end() {
        this.lastScale = undefined;
    }
}
