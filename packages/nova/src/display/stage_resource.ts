import { Resource } from "nova_ecs/resource";
import * as PIXI from "pixi.js";

/**
 * The display world's UI layer, and the container every UI element adds
 * itself to: the status bar, the spaceport and its venues, the star map,
 * the dialogs and popups, the status line.
 *
 * Scaled by the player's **UI scale** (see display_scale.ts), which is why
 * the world view is NOT in here — the starfield, the ambient haze and the
 * `Space` container live in `WorldLayer` instead, and both hang off
 * `DisplayRoot`. Positions inside this container are in UI-logical units,
 * which is what the `ScreenSize` resource reports.
 */
export const Stage = new Resource<PIXI.Container>('Stage');

/**
 * The world view: the starfield, the ambient murk haze, and the `Space`
 * container that holds every ship, planet, shot and overlay.
 *
 * Never scaled by the UI scale — only by the global scale, which lives on
 * the renderer rather than on any container. Positions in here are in
 * world-logical units, which is what `WorldScreenSize` reports.
 */
export const WorldLayer = new Resource<PIXI.Container>('WorldLayer');

/**
 * The display world's root container — `[WorldLayer, Stage]`, in that
 * draw order. This is what the client adds to `app.stage` and removes on
 * teardown; the two layers below it never move between parents.
 */
export const DisplayRoot = new Resource<PIXI.Container>('DisplayRoot');
