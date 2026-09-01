/**
 * Display scaling: how the window's CSS pixels, the device pixel ratio and
 * the player's two scale preferences turn into PIXI renderer settings.
 *
 * Everything here is DISPLAY-ONLY and CLIENT-LOCAL. No value in this module
 * reaches the simulation, an input record or a save; two peers running at
 * different scales stay in lockstep.
 *
 * ## The three numbers
 *
 * - **devicePixelRatio (DPR)** — physical pixels per CSS pixel. It is what
 *   the browser's *page zoom* moves: zooming to 150% multiplies DPR by 1.5
 *   and shrinks `innerWidth` by the same factor.
 * - **globalScale (G)** — the player's "make everything bigger" knob. It
 *   scales the world view *and* the UI, and (because the window is a fixed
 *   number of pixels) it correspondingly REDUCES how much of the system is
 *   on screen. That is what "the scale of everything" means.
 * - **uiScale (U)** — an additional multiplier on the UI layers only
 *   (status bar, spaceport, dialogs, popups, title). World entities, the
 *   starfield and the radar's contents are untouched by it.
 *
 * ## Why the renderer, not a container, carries the global scale
 *
 * A root-container `scale.set(G)` is a cheap zoom, but it rasterizes every
 * glyph at the renderer's resolution and then stretches the result: text
 * gets exactly as blurry as the zoom is large. Instead the global scale is
 * folded into the renderer:
 *
 * - `renderer.resolution = DPR * G` — one *logical* unit is now G CSS
 *   pixels, i.e. `G * DPR` physical pixels.
 * - `renderer.resize(cssWidth / G, cssHeight / G)` — the logical viewport
 *   shrinks, so the same art covers more of the window.
 * - the canvas backing store therefore ends up at `cssWidth * DPR`
 *   physical pixels: exactly one texel per physical pixel, at any G.
 *
 * The canvas's CSS size has to be pinned separately (see
 * `applyRendererScale`): PIXI's `autoDensity` writes the *logical* size
 * into `style.width`, which is only right when `G === 1`.
 *
 * ## Why text needs its own resolution
 *
 * `PIXI.Text` auto-resolution follows `renderer.resolution` and knows
 * nothing about the transform of the container it sits in. A UI layer
 * scaled by U would draw a texture rasterized for `DPR * G` at `U` times
 * its natural size — blurry again. So text is rasterized at
 * `DPR * G * U` (`textResolution` below) and drawn at scale U, which is
 * one texel per physical pixel once more. World text is over-sampled by a
 * factor of U, which costs a little texture memory and never looks worse.
 */

import * as PIXI from 'pixi.js';

/** Smallest scale the settings accept. */
export const MIN_SCALE = 0.5;
/** Largest scale the settings accept. */
export const MAX_SCALE = 3;
/** The increment the hotkeys and the preferences slider move by. */
export const SCALE_STEP = 0.25;

/**
 * Ceiling on the resolution glyph textures are rasterized at.
 *
 * `DPR * G * U` can reach 18 (a 2x display at 3x global and 3x UI), and a
 * text canvas that big is a real memory and upload cost for no visible
 * gain. Text is drawn from an atlas-less canvas per string, so the cap
 * matters more here than for sprites.
 */
export const MAX_TEXT_RESOLUTION = 4;
/** Floor on the same, so a tiny scale can never ask for a 0-sized canvas. */
export const MIN_TEXT_RESOLUTION = 0.25;

/** What the window and the player's preferences currently are. */
export interface ScaleInputs {
    /** `window.devicePixelRatio` (physical pixels per CSS pixel). */
    devicePixelRatio: number;
    /** `window.innerWidth`, in CSS pixels. */
    cssWidth: number;
    /** `window.innerHeight`, in CSS pixels. */
    cssHeight: number;
    /** The player's global scale (world + UI). */
    globalScale: number;
    /** The player's UI-only scale, on top of the global one. */
    uiScale: number;
}

/** Everything the renderer, the layers and the text need, derived. */
export interface ScaleLayout {
    /** `renderer.resolution`: physical pixels per logical unit. */
    resolution: number;
    /** `renderer.resize()` width: the world view's logical width. */
    worldWidth: number;
    /** `renderer.resize()` height: the world view's logical height. */
    worldHeight: number;
    /** `canvas.style.width`, in CSS pixels: always the whole window. */
    cssWidth: number;
    /** `canvas.style.height`, in CSS pixels. */
    cssHeight: number;
    /** The scale to put on the UI layer container. */
    uiScale: number;
    /** The UI layer's logical width (what `ScreenSize.x` reports). */
    uiWidth: number;
    /** The UI layer's logical height (what `ScreenSize.y` reports). */
    uiHeight: number;
    /** `PIXI.Text.resolution` for crisp glyphs at this UI scale. */
    textResolution: number;
}

/**
 * Clamps a scale preference into range and snaps it to `SCALE_STEP`.
 *
 * Anything unusable (NaN, Infinity, a non-number out of localStorage)
 * falls back to 1, so a corrupt preference can never leave the player with
 * an unusable window.
 */
export function clampScale(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1;
    }
    const snapped = Math.round(value / SCALE_STEP) * SCALE_STEP;
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, snapped));
    // Snapping in floating point leaves 1.7500000000000002-style dust;
    // the settings are quarter steps, so two decimals is exact.
    return Math.round(clamped * 100) / 100;
}

/** Moves a scale by `steps` increments, clamped to the legal range. */
export function stepScale(value: number, steps: number): number {
    return clampScale(clampScale(value) + steps * SCALE_STEP);
}

/** A scale as the readouts show it: "100%", "125%", "250%". */
export function formatScale(value: number): string {
    return `${Math.round(clampScale(value) * 100)}%`;
}

/** The status-line readout the scale hotkeys post. */
export function describeDisplayScale(
    settings: { uiScale: number, globalScale: number }): string {
    return `UI scale ${formatScale(settings.uiScale)}, `
        + `global scale ${formatScale(settings.globalScale)}.`;
}

/** Derives the renderer/layer/text numbers from the window + preferences. */
export function computeScaleLayout(inputs: ScaleInputs): ScaleLayout {
    const dpr = Number.isFinite(inputs.devicePixelRatio)
        && inputs.devicePixelRatio > 0 ? inputs.devicePixelRatio : 1;
    const globalScale = clampScale(inputs.globalScale);
    const uiScale = clampScale(inputs.uiScale);
    const worldWidth = inputs.cssWidth / globalScale;
    const worldHeight = inputs.cssHeight / globalScale;
    return {
        resolution: dpr * globalScale,
        worldWidth,
        worldHeight,
        cssWidth: inputs.cssWidth,
        cssHeight: inputs.cssHeight,
        uiScale,
        uiWidth: worldWidth / uiScale,
        uiHeight: worldHeight / uiScale,
        textResolution: Math.min(MAX_TEXT_RESOLUTION, Math.max(
            MIN_TEXT_RESOLUTION, dpr * globalScale * uiScale)),
    };
}

/**
 * Snaps a logical coordinate so it lands on a whole physical pixel.
 *
 * A sprite or a glyph drawn at a half pixel is resampled by the LINEAR
 * filter, which is exactly what "the text looks blurry" is: every centred
 * dialog sits at `screenSize / 2`, and an odd window height put every one
 * of them on a half pixel. `factor` is physical pixels per unit of the
 * coordinate's own space — `resolution` for a world-layer coordinate,
 * `resolution * uiScale` for a UI-layer one.
 */
export function snapToPixel(value: number, factor = 1): number {
    if (!Number.isFinite(value) || !Number.isFinite(factor) || factor <= 0) {
        return value;
    }
    return Math.round(value * factor) / factor;
}

/**
 * Points `PIXI.Text` at a fixed rasterization resolution.
 *
 * Text is created all over the codebase (130-odd call sites), so the
 * resolution is set through the class defaults rather than threaded
 * through every constructor. Auto-resolution has to be turned OFF: it
 * would otherwise overwrite `_resolution` with the renderer's on the next
 * render, throwing away the UI-scale factor.
 */
export function setDefaultTextResolution(resolution: number): void {
    PIXI.Text.defaultAutoResolution = false;
    PIXI.Text.defaultResolution = resolution;
}

/**
 * Re-rasterizes every `PIXI.Text` under `root` at `resolution`.
 *
 * Needed for LIVE scale changes: `setDefaultTextResolution` only affects
 * text created afterwards, and the status bar's readouts, the spaceport's
 * panels and the title's captions all exist already. Assigning
 * `resolution` marks the text dirty, so the glyphs are redrawn on the
 * next frame.
 *
 * Returns how many text objects were visited (handy in specs).
 */
export function refreshTextResolution(root: PIXI.Container,
    resolution: number): number {
    let visited = 0;
    const visit = (node: PIXI.Container) => {
        if (node instanceof PIXI.Text) {
            visited++;
            if (node.resolution !== resolution) {
                node.resolution = resolution;
            }
        }
        for (const child of node.children) {
            if (child instanceof PIXI.Container) {
                visit(child);
            }
        }
    };
    visit(root);
    return visited;
}

/**
 * The minimum a renderer has to expose for `applyRendererScale`. Kept
 * structural so specs can drive it without a WebGL context.
 */
export interface ScalableView {
    resolution: number;
    resize(width: number, height: number): void;
    readonly view: { style?: { width: string, height: string } };
}

/**
 * Pushes a computed layout into the renderer.
 *
 * The canvas's CSS size is written AFTER the resize on purpose: PIXI's
 * `autoDensity` sets `style.width` to the *logical* width during
 * `resize()`, which is only the window's width when the global scale is
 * 1. Overwriting it here is what keeps the canvas filling the window
 * while the logical viewport shrinks underneath it.
 */
export function applyRendererScale(renderer: ScalableView,
    layout: ScaleLayout): void {
    renderer.resolution = layout.resolution;
    renderer.resize(layout.worldWidth, layout.worldHeight);
    const style = renderer.view.style;
    if (style) {
        style.width = `${layout.cssWidth}px`;
        style.height = `${layout.cssHeight}px`;
    }
}
