import { Resource } from 'nova_ecs/resource';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';

/**
 * The window changed size, or the player changed a display scale.
 *
 * `x`/`y` are the **UI-logical** viewport: CSS pixels divided by the
 * global scale *and* the UI scale, i.e. the coordinate space the `Stage`
 * (UI) container draws in. `worldX`/`worldY` are the **world-logical**
 * viewport: CSS pixels divided by the global scale only, the space the
 * `WorldLayer` draws in. They are equal whenever the UI scale is 1, which
 * is why the world pair is optional — a caller that predates the scale
 * settings, or a test that only cares about UI layout, can omit it and
 * both resources track the one size it gave.
 */
export const ResizeEvent = new EcsEvent<{
    x: number, y: number, worldX?: number, worldY?: number,
}>('Resize');

/**
 * The UI-logical viewport size. Every UI element positions itself against
 * this: the status bar anchors at `x - width`, dialogs centre at `x / 2`,
 * the status line sits at `y`. It shrinks as the UI scale grows, which is
 * exactly what makes a bigger UI cover more of the window.
 */
export const ScreenSize = new Resource<{ x: number, y: number }>('ScreenSize');

/**
 * The world-logical viewport size: how much of the star system fits on
 * screen. Unaffected by the UI scale, scaled down by the global scale.
 * Read by the camera (CenterShipSystem) and the starfield.
 */
export const WorldScreenSize =
    new Resource<{ x: number, y: number }>('WorldScreenSize');

/**
 * The live display scales, mirrored into the display world so systems
 * that have to convert between the two layers can do the arithmetic.
 *
 * The camera is the one that needs it: the status bar's width is a
 * UI-layer measurement, and the world view is centred in the part of the
 * screen the status bar does not cover, so the width has to be multiplied
 * by `ui` to become a world-layer distance.
 */
export const DisplayScaleResource = new Resource<{
    /** The UI-only multiplier (`Stage.scale`). */
    ui: number,
    /** The everything multiplier, carried by the renderer's resolution. */
    global: number,
}>('DisplayScale');

/**
 * The centre of a viewport, snapped to a whole logical pixel.
 *
 * Half-pixel placement is the classic PIXI blur: with LINEAR filtering a
 * dialog whose origin sits at `x.5` resamples every glyph in it. An odd
 * window height (very common — browser chrome eats an arbitrary number of
 * rows) put every centred dialog on exactly that half pixel, so the
 * spaceport's text was soft while the status bar's, anchored to an
 * integer right edge, was not.
 */
export function screenCentre(screen: { x: number, y: number }):
    { x: number, y: number } {
    return { x: Math.round(screen.x / 2), y: Math.round(screen.y / 2) };
}

/** Anything with a PIXI-style position and an optional destroyed flag:
 * kept structural so this module needs no PIXI import. */
export interface Centrable {
    position: { set(x: number, y: number): void };
    destroyed?: boolean;
}

/** Puts `container`'s origin on the centre of `screen` (see screenCentre). */
export function centreOn(container: Centrable,
    screen: { x: number, y: number }) {
    const { x, y } = screenCentre(screen);
    container.position.set(x, y);
}

/**
 * The UI containers that stay centred on the whole viewport: the in-flight
 * dialogs (ship offers, mission ship-done text, the comm channel, the
 * mission and player info boxes, the full map), every one drawn about its
 * own origin.
 *
 * The original centres them on the WHOLE screen, not on the space view the
 * status bar leaves: at 1920x1080 the plunder dialog spans x 806..1114,
 * the comm dialog 749..1171 and the desc+pict mission text 636..1280 — all
 * centred on x 960, none on the ~863 of the 1726px space view — and all at
 * y 540 (board_ship.png, hail.png, 5_sigma_1_mission_text_with_pict.png).
 *
 * Centring once at build was the bug: the plugins build while ScreenSize
 * still holds ScreenSizePlugin's CSS-pixel seed, before the client's first
 * ResizeEvent hands the world its UI-logical size, so with any UI or
 * global scale above 1 a dialog sat at (cssW/2, cssH/2) UI units — down
 * and to the right, against the status bar — and it never followed a
 * window resize either. Registered containers are centred on the live
 * size now and on every ResizeEvent (CentreUiSystem).
 */
export const CentredUiResource = new Resource<Set<Centrable>>('CentredUi');

/**
 * Centres `container` on the world's current ScreenSize now and keeps it
 * centred through every resize. The owner calls stopCentring in its
 * plugin's remove() before destroying the container.
 */
export function keepCentred(world: World, container: Centrable) {
    const screen = world.resources.get(ScreenSize);
    if (screen) {
        centreOn(container, screen);
    }
    let centred = world.resources.get(CentredUiResource);
    if (!centred) {
        centred = new Set();
        world.resources.set(CentredUiResource, centred);
    }
    centred.add(container);
}

/** Undoes keepCentred (safe when it was never registered). */
export function stopCentring(world: World, container: Centrable) {
    world.resources.get(CentredUiResource)?.delete(container);
}

/** The shape `clientToWorld` / `clientToUi` need. */
export type DisplayScales = { ui: number, global: number };

/**
 * A `clientX`/`clientY` (CSS pixels, from a DOM pointer event) in
 * WORLD-layer logical units — what `Space` and the entity positions are
 * in. The global scale is carried by the renderer's resolution, so it
 * never shows up in the DOM's coordinates and has to be divided out here.
 */
export function clientToWorld(client: number, scale: DisplayScales): number {
    return client / (scale.global || 1);
}

/** The same, in UI-layer logical units (the `Stage` container's space). */
export function clientToUi(client: number, scale: DisplayScales): number {
    return client / ((scale.global || 1) * (scale.ui || 1));
}

export const ResizeSystem = new System({
    name: 'ResizeSystem',
    events: [ResizeEvent],
    args: [ResizeEvent, ScreenSize, WorldScreenSize] as const,
    step({ x, y, worldX, worldY }, screenSize, worldSize) {
        screenSize.x = x;
        screenSize.y = y;
        worldSize.x = worldX ?? x;
        worldSize.y = worldY ?? y;
    }
});

/** Re-centres every CentredUiResource container on a resize. */
export const CentreUiSystem = new System({
    name: 'CentreUiSystem',
    events: [ResizeEvent],
    args: [ResizeEvent, CentredUiResource] as const,
    step(resize, centred) {
        for (const container of centred) {
            if (!container.destroyed) {
                centreOn(container, resize);
            }
        }
    },
    // #156 pin (shared: ResizeEvent): after the size resources update, so
    // a handler that reads ScreenSize sees the same size this one used.
    after: [ResizeSystem],
});

export const ScreenSizePlugin: Plugin = {
    name: 'ScreenSize',
    build(world) {
        // Seeded from the window; the client re-emits ResizeEvent with the
        // scale-corrected sizes as soon as the world is wired up, and on
        // every resize and scale change after that.
        world.resources.set(ScreenSize,
            { x: window.innerWidth, y: window.innerHeight })
        world.resources.set(WorldScreenSize,
            { x: window.innerWidth, y: window.innerHeight })
        if (!world.resources.has(DisplayScaleResource)) {
            world.resources.set(DisplayScaleResource, { ui: 1, global: 1 });
        }
        if (!world.resources.has(CentredUiResource)) {
            world.resources.set(CentredUiResource, new Set());
        }
        world.addSystem(ResizeSystem);
        world.addSystem(CentreUiSystem);
    },
    remove(world) {
        world.removeSystem(CentreUiSystem);
        world.removeSystem(ResizeSystem);
        world.resources.delete(CentredUiResource);
        world.resources.delete(ScreenSize);
        world.resources.delete(WorldScreenSize);
        world.resources.delete(DisplayScaleResource);
    }
}
