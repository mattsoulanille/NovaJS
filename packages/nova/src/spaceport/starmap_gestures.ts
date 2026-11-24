// Pure gesture math for the map pane (starmap_input.ts binds it to PIXI):
// converting pointer deltas into the pane's own units. Free of PIXI so it
// can be unit tested (starmap_gestures_test.ts).

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
