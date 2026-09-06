// Pure pointer hit-testing / click-vs-drag decision logic for the starmap.
// Kept free of PIXI so it can be unit tested in isolation (starmap_hit_test.ts)
// and reused by the map pane's pointer binding (starmap_input.ts) and
// viewport (starmap_viewport.ts) under SystemGraph (system_graph.ts).
//
// BACKGROUND (the "swallowed first click" bug): PIXI's EventBoundary always
// synthesizes a `pointertap` for a pointerdown -> pointerup on the same target,
// whether or not a `pointermove` happened in between and no matter how far the
// pointer travelled — it never distinguishes a click from a drag. That
// decision is entirely up to us. The map used to promote a gesture to a drag
// on ANY nonzero pointer movement, so the pixel or two of jitter a physical
// click produces between press and release was misread as a drag and the tap
// discarded. You'd click once and nothing happened; clicking again without
// moving (a perfectly still press) registered. The deadzone below fixes that:
// a gesture only becomes a drag once the pointer leaves a small circle around
// the press point.

/**
 * Screen-pixel radius the pointer must travel from where it went DOWN before
 * a gesture counts as a drag (a pan) rather than a click. Measured from the
 * press origin, not accumulated per-move, so back-and-forth jitter never adds
 * up to a false drag while a genuine drag still crosses it quickly.
 */
export const DRAG_THRESHOLD = 4;

/**
 * Whether a gesture whose pointer has moved (dx, dy) SCREEN pixels from its
 * press origin should be treated as a drag rather than a click.
 */
export function isDragGesture(dx: number, dy: number,
    threshold = DRAG_THRESHOLD): boolean {
    return dx * dx + dy * dy > threshold * threshold;
}

/**
 * Converts a point in the map viewport (container-local screen pixels) to
 * laid-out world coordinates, undoing the map container's pan (panX, panY)
 * and zoom. Inverse of the transform SystemGraph applies to mapContainer.
 */
export function screenToWorld(viewX: number, viewY: number,
    panX: number, panY: number, zoom: number): [number, number] {
    return [(viewX - panX) / zoom, (viewY - panY) / zoom];
}

/**
 * The click-acceptance radius in WORLD (laid-out) coordinates at a given zoom.
 * A generous CLICK_RADIUS of screen pixels around each dot makes systems easy
 * to hit (in-character with the original's forgiving map), but the target is
 * never shrunk below the drawn circle when zoomed in.
 */
export function clickRadiusWorld(zoom: number, systemRadius: number,
    clickRadius: number): number {
    return Math.max(systemRadius, clickRadius / zoom);
}

/**
 * The click-vs-drag state machine for a single pointer on the map, free of
 * PIXI so it can be unit tested. SystemGraph feeds it raw screen-space pointer
 * positions; it decides when a gesture has become a drag (so pointertap should
 * be ignored) and reports the pan delta to apply while dragging.
 *
 * A gesture stays a click until the pointer leaves the DRAG_THRESHOLD deadzone
 * around the press point, and `dragged` stays set after release until the next
 * press so the tap that PIXI fires right after pointerup can consult it.
 */
export class DragTracker {
    private origin?: { pointerId: number, x: number, y: number };
    private lastX = 0;
    private lastY = 0;
    private dragging = false;

    /** Begins a gesture at the press point, resetting the drag state. */
    down(pointerId: number, x: number, y: number) {
        this.origin = { pointerId, x, y };
        this.lastX = x;
        this.lastY = y;
        this.dragging = false;
    }

    /**
     * Advances the gesture to a new pointer position. Returns the screen-space
     * pan delta to apply, or null when there's nothing to pan — either the
     * event is for a different pointer / no active gesture, or the pointer is
     * still inside the click deadzone. The first delta after crossing the
     * deadzone spans the whole distance from the press point, so panning
     * catches up in one step instead of jumping.
     */
    move(pointerId: number, x: number, y: number): { dx: number, dy: number } | null {
        if (!this.origin || pointerId !== this.origin.pointerId) {
            return null;
        }
        if (!this.dragging) {
            if (!isDragGesture(x - this.origin.x, y - this.origin.y)) {
                return null;
            }
            this.dragging = true;
        }
        const dx = x - this.lastX;
        const dy = y - this.lastY;
        this.lastX = x;
        this.lastY = y;
        return { dx, dy };
    }

    /** Ends the gesture. Ignores a release from a different pointer. */
    up(pointerId: number) {
        if (this.origin && pointerId !== this.origin.pointerId) {
            return;
        }
        this.origin = undefined;
    }

    /**
     * Whether the gesture that just ended (or is in progress) has become a
     * drag, so the pointertap it produces should NOT select a system. Stays
     * set until the next `down`, matching when the tap fires.
     */
    get dragged(): boolean {
        return this.dragging;
    }
}

/**
 * Index of the target nearest to (worldX, worldY) within `radius` world units,
 * or -1 if none is in range. Ties resolve to the later target (matching the
 * original `<=` sweep, which lets a system drawn after another on the same
 * spot win). Pure so the hit resolution can be tested without PIXI.
 */
export function nearestTargetIndex(
    targets: readonly { x: number, y: number }[],
    worldX: number, worldY: number, radius: number): number {
    let best = -1;
    let bestDistSq = radius * radius;
    for (let i = 0; i < targets.length; i++) {
        const dx = targets[i].x - worldX;
        const dy = targets[i].y - worldY;
        const distSq = dx * dx + dy * dy;
        if (distSq <= bestDistSq) {
            best = i;
            bestDistSq = distSq;
        }
    }
    return best;
}
