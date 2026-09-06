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
// How far the arrow keys pan per press, in screen pixels.
export const KEY_PAN_STEP = 40;
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
        private readonly worldBounds: WorldBounds) {
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
        if (newZoom === oldZoom) {
            return;
        }
        // Keep the world point under (centerX, centerY) stationary on screen.
        const pos = this.mapContainer.position;
        const worldX = (centerX - pos.x) / oldZoom;
        const worldY = (centerY - pos.y) / oldZoom;
        this.zoomLevel = newZoom;
        pos.set(centerX - worldX * newZoom, centerY - worldY * newZoom);
        this.applyZoom();
    }

    applyZoom() {
        this.mapContainer.scale.set(this.zoomLevel);
        this.clampPosition();
    }

    /**
     * Keeps the map from being panned entirely out of view. The galaxy is
     * allowed to move until only a margin of it remains inside the viewport.
     */
    private clampPosition() {
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
