// The starmap's geometry: how system positions are laid out, and the
// pan/zoom transform the map container carries on top of that layout.
// Panning and zooming never redraw anything — they only move and scale
// the map container — so everything else on the map is drawn once.
import * as PIXI from 'pixi.js';
import {
    clickRadiusWorld, nearestTargetIndex, screenToWorld,
} from "./starmap_hit.js";

// The scale at which system positions are laid out. Zoom is applied on top of
// this as a transform on the map container, so systems are only drawn once.
export const BASE_SCALE = 2;
// How far the view can be zoomed relative to BASE_SCALE.
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.15;
/**
 * The original's map scale, in screen px per map unit: what the full map
 * OPENS at and what the `h` minimap always draws at (reference_experiments
 * M6). Measured on the test kit's map region (832x604 window), dot centre
 * to dot centre from the hub: 40 units east +71 px, 80 east +142, 60
 * east +106, 50 west -89, 50 south +88, 70 south +124 — a least-squares
 * fit of 1.772, and the 1920x1080 captures agree (Sol->Tichel, 110 units,
 * 195 px). 16/9 = 1.778 looks like a plausible "round" constant, but it
 * predicts +107 and +89 for two of those six where the capture has 106 and
 * 88; 1.77 rounds to every one of them, so the measured value is used.
 */
export const DEFAULT_PX_PER_UNIT = 1.77;
/** {@link DEFAULT_PX_PER_UNIT} as a zoom over the laid-out map. */
export const DEFAULT_ZOOM = DEFAULT_PX_PER_UNIT / BASE_SCALE;
/**
 * The original's map scales, screen px per map unit, smallest first: it
 * has exactly SEVEN zoom levels, 42.1, 56.2, 75, 100, 133.3, 177.7 and
 * 237 % (the Bible's list; reference "Star-map nebulae (nëbu), wave 53",
 * item 1: five `-` from the opening level reach the last, one `=`
 * reaches 237 %, and the fitted scales are within 0.5 % of these). The
 * opening level is {@link DEFAULT_PX_PER_UNIT}, the measured 1.77 (wave
 * 2), so the map opens exactly on a level. Used with the "Smooth map
 * zoom" enhancement off; on, the zoom is continuous.
 */
export const ORIGINAL_MAP_SCALES: readonly number[] = [
    0.421, 0.562, 0.75, 1, 1.333, DEFAULT_PX_PER_UNIT, 2.37,
];
/** {@link ORIGINAL_MAP_SCALES} as zooms over the laid-out map. */
export const ORIGINAL_ZOOM_LEVELS: readonly number[] =
    ORIGINAL_MAP_SCALES.map(scale => scale / BASE_SCALE);
// How far the arrow keys pan per press, in screen pixels (NovaJS, the
// "Smooth map zoom" enhancement on).
export const KEY_PAN_STEP = 40;
/** How far an arrow press pans the original's map: 10 MAP UNITS at every
 * zoom (wave 53: 24 px at 237 %, 17.8 at 177.7 %, 4.2 at 42.1 %). */
export const ORIGINAL_KEY_PAN_UNITS = 10;

/**
 * The original-zoom level one step from `zoom` in `direction` (+1 in, -1
 * out): the next of {@link ORIGINAL_ZOOM_LEVELS} beyond the current zoom,
 * so a zoom between two levels (left by smooth zooming) snaps to the
 * neighbouring one. Undefined past the last level that way (the original
 * greys the button out there, and a further press changes nothing).
 */
export function originalZoomStep(zoom: number,
    direction: 1 | -1): number | undefined {
    // A level the view is already on (to rounding) does not count as
    // "beyond" it.
    const epsilon = 1e-6;
    if (direction > 0) {
        return ORIGINAL_ZOOM_LEVELS.find(level => level > zoom + epsilon);
    }
    return [...ORIGINAL_ZOOM_LEVELS].reverse()
        .find(level => level < zoom - epsilon);
}
// Radius of a system's outer circle in laid-out coordinates.
export const SYSTEM_RADIUS = 2.7 * BASE_SCALE;
// How close (in screen pixels) a click must be to a system to select it.
const CLICK_RADIUS = 12;

/** A map position in laid-out (BASE_SCALE) coordinates. */
export function scalePos(pos: readonly [number, number]): [number, number] {
    return [pos[0] * BASE_SCALE, pos[1] * BASE_SCALE];
}

/** Bounding box of a set of points in laid-out (BASE_SCALE) coordinates. */
export interface WorldBounds {
    minX: number, minY: number, maxX: number, maxY: number,
}

export function worldBoundsOf(
    positions: Iterable<readonly [number, number]>): WorldBounds {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const position of positions) {
        const [x, y] = scalePos(position);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX)) {
        minX = minY = maxX = maxY = 0;
    }
    return { minX, minY, maxX, maxY };
}

/**
 * The pannable, zoomable, masked view of the galaxy. Owns the map
 * container everything on the map is drawn into, its clip mask, and the
 * zoom/pan state; clients draw into {@link mapContainer} once and move
 * the view with {@link pan} / {@link zoomBy} / {@link centerOn}.
 */
export class MapViewport {
    /** The layer every map element is drawn into, in laid-out
     * coordinates; pan and zoom are this container's transform. */
    readonly mapContainer = new PIXI.Container();
    // Zoom is a transform applied on top of BASE_SCALE. Panning and zooming
    // never redraw the systems; they only move/scale mapContainer.
    private zoomLevel = 1;

    /**
     * Attaches the masked view to `root`, clipping it to `size`.
     * `worldBounds` is the galaxy's extent, which {@link clampPosition}
     * keeps from being panned entirely out of view.
     */
    constructor(root: PIXI.Container,
        readonly size: { x: number, y: number },
        private readonly worldBounds: WorldBounds,
        /** Whether pans are clamped to {@link worldBounds} (NovaJS) or
         * free (the original). Read at every pan and zoom. */
        private readonly bounded: () => boolean = () => true) {
        const maskedContainer = new PIXI.Container();
        const mask = new PIXI.Graphics();
        mask.beginFill(0xff0000);
        mask.drawRect(0, 0, size.x, size.y);
        mask.endFill();
        maskedContainer.mask = mask;
        root.addChild(mask);

        maskedContainer.addChild(this.mapContainer);
        root.addChild(maskedContainer);
    }

    get zoom(): number {
        return this.zoomLevel;
    }

    /** Centers a laid-out world point in the viewport at the current zoom. */
    centerOn(worldX: number, worldY: number) {
        this.mapContainer.position.set(
            this.size.x / 2 - worldX * this.zoomLevel,
            this.size.y / 2 - worldY * this.zoomLevel,
        );
        this.clampPosition();
    }

    /** Pans the map by a screen-space delta (used by the arrow keys). */
    pan(dx: number, dy: number) {
        this.mapContainer.position.x += dx;
        this.mapContainer.position.y += dy;
        this.clampPosition();
    }

    /**
     * Zooms by `factor`, keeping the point at (centerX, centerY) in the
     * viewport fixed. If no center is given, zooms around the viewport center.
     */
    zoomBy(factor: number, centerX = this.size.x / 2, centerY = this.size.y / 2) {
        const oldZoom = this.zoomLevel;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
        // A view left outside the smooth range by the original's levels
        // (42.1 % is below MIN_ZOOM) only moves back the way it was asked.
        if (newZoom === oldZoom || (factor < 1) !== (newZoom < oldZoom)) {
            return;
        }
        this.zoomTo(newZoom, centerX, centerY);
    }

    /**
     * Sets the zoom to exactly `zoom` (no smooth-range clamp: the
     * original's levels reach below it), keeping the point at (centerX,
     * centerY) in the viewport fixed.
     */
    zoomTo(zoom: number, centerX = this.size.x / 2,
        centerY = this.size.y / 2) {
        const oldZoom = this.zoomLevel;
        if (!(zoom > 0) || zoom === oldZoom) {
            return;
        }
        // Keep the world point under (centerX, centerY) stationary on screen.
        const pos = this.mapContainer.position;
        const worldX = (centerX - pos.x) / oldZoom;
        const worldY = (centerY - pos.y) / oldZoom;
        this.zoomLevel = zoom;
        pos.set(centerX - worldX * zoom, centerY - worldY * zoom);
        this.applyZoom();
    }

    applyZoom() {
        this.mapContainer.scale.set(this.zoomLevel);
        this.clampPosition();
    }

    /**
     * Keeps the map from being panned entirely out of view. The galaxy is
     * allowed to move until only a margin of it remains inside the viewport.
     * Unless {@link bounded} says no: the original's pan is unbounded
     * (wave 53: about 800 map units each way, never clamped).
     */
    private clampPosition() {
        if (!this.bounded()) {
            return;
        }
        const b = this.worldBounds;
        const margin = 40;
        const pos = this.mapContainer.position;
        // Screen-space extent of the galaxy at the current zoom.
        const left = b.minX * this.zoomLevel;
        const right = b.maxX * this.zoomLevel;
        const top = b.minY * this.zoomLevel;
        const bottom = b.maxY * this.zoomLevel;

        // Clamp so at least `margin` px of the galaxy stays on each edge.
        const minPosX = margin - right;
        const maxPosX = this.size.x - margin - left;
        const minPosY = margin - bottom;
        const maxPosY = this.size.y - margin - top;
        pos.x = Math.min(maxPosX, Math.max(minPosX, pos.x));
        pos.y = Math.min(maxPosY, Math.max(minPosY, pos.y));
    }

    /**
     * The index of the target nearest to a point in viewport coordinates,
     * or -1 if none is within clicking distance.
     */
    targetAt(targets: readonly { x: number, y: number }[],
        viewX: number, viewY: number): number {
        const pos = this.mapContainer.position;
        const [worldX, worldY] =
            screenToWorld(viewX, viewY, pos.x, pos.y, this.zoomLevel);
        // Accept clicks within CLICK_RADIUS on screen, but never make the
        // target smaller than the drawn circle.
        const radius =
            clickRadiusWorld(this.zoomLevel, SYSTEM_RADIUS, CLICK_RADIUS);
        return nearestTargetIndex(targets, worldX, worldY, radius);
    }
}
