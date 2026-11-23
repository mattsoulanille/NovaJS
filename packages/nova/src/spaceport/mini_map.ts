// The in-flight hyperspace minimap: what `h` (controls.json `smallMap`, the
// original's "Hyperspace Mode" key) toggles over the space view, measured on
// ui_screenshots/original_macos_screenshots/map/mini_map/mini_map.png
// (1920x1080, "Jumping into the Tau Ceti system"):
//
//  * A 480x480 square whose 1px outline is #080808 — cölr FloatingMap,
//    "Floating hyperspace map / escort menu border color" (Bible) — at
//    x 1230..1709, y 150..629: its top edge 150px down, its right edge 16px
//    clear of the status bar (which starts at x 1726).
//  * INSIDE, NO BACKGROUND: a star of the space view shows through at
//    (1416,155). Only the map is drawn — lanes, dots, labels, mission
//    arrows, the route — centred on the current system, at the original
//    full map's default scale (Sol->Tau Ceti spans the same 18x53 px on
//    both captures: ~1.78 px per map unit; see MINI_MAP_ZOOM).
//  * The route is a thin green line; the current system is marked by its
//    cyan centre alone (no dashed ring, no selection brackets, no pinned
//    waypoint boxes).
//
// What it does (Matthew, 2026-11-23): a click on a neighbour of the current
// system picks it as the single next jump — the full map's single-jump rule
// (SystemGraphOptions.miniMap) — and shift-click does nothing. The pick is
// committed the moment it is made, through the very path the full map's
// Done takes (StarmapPlugin.commitRoute -> SetJumpRouteEvent ->
// setPlayerJumpRoute input record), so the route a peer simulates is the
// one this player's minimap shows.
//
// It is an overlay, not a dialog: it binds no MenuControls, the simulation
// keeps running, and every flight key still flies the ship. Only `h` closes
// it; Escape keeps its in-flight meaning. A click on it is a click on UI
// (its pane is hit-testable), so it never falls through to tap-targeting
// a ship or planet underneath.
import * as PIXI from 'pixi.js';
import { Subject, Subscription } from 'rxjs';
import { SystemGraph } from './system_graph.js';

/** The map pane: the frame's inside. */
export const MINI_MAP_PANE = { x: 478, y: 478 };
/** The frame: the pane plus its 1px outline on every side. */
export const MINI_MAP_FRAME = MINI_MAP_PANE.x + 2;
/** The outline (cölr FloatingMap as measured; cölr is not plumbed through
 * the game data yet — see item_grid.ts gridDim/gridBright). */
export const MINI_MAP_FRAME_COLOR = 0x080808;
/**
 * The minimap's zoom over the laid-out map (BASE_SCALE = 2 px per map unit):
 * the reference's ~1.778 px per unit (Sol->Tichel is 195 px for 110 units
 * on both mini_map.png and the full-map captures). NovaJS's FULL map opens
 * at zoom 1 — 12.5% larger than the original's — so the two maps differ in
 * scale here where the original's agree; the minimap follows the capture.
 */
export const MINI_MAP_ZOOM = 1.778 / 2;
/** The frame's top edge, in UI-logical pixels. */
export const MINI_MAP_TOP = 150;
/** Clear pixels between the frame's right edge and the status bar. */
export const MINI_MAP_STATUS_BAR_GAP = 16;

/**
 * Where the frame's top-left corner goes, on a UI-logical screen of
 * `screen` with the status bar `statusBarWidth` wide against its right
 * edge. Anchored to the status bar like the original (the only capture is
 * 1920x1080, so how it moves at other sizes is an assumption).
 */
export function miniMapPosition(screen: { x: number },
    statusBarWidth: number): { x: number, y: number } {
    return {
        x: screen.x - statusBarWidth - MINI_MAP_STATUS_BAR_GAP
            - MINI_MAP_FRAME,
        y: MINI_MAP_TOP,
    };
}

export class MiniMap {
    readonly container = new PIXI.Container();
    /** Emits the graph each time the player picks (or un-picks) a jump. */
    readonly picked = new Subject<SystemGraph>();
    private readonly frame = new PIXI.Graphics();
    private graph?: SystemGraph;
    private graphSubscription?: Subscription;

    constructor() {
        this.container.name = 'MiniMap';
        this.container.visible = false;
        // The outline only: the space view shows through the pane.
        this.frame.lineStyle(1, MINI_MAP_FRAME_COLOR, 1, 0);
        this.frame.drawRect(0, 0, MINI_MAP_FRAME, MINI_MAP_FRAME);
        this.container.addChild(this.frame);
    }

    /** The graph on show, if one has been set. */
    get current(): SystemGraph | undefined {
        return this.graph;
    }

    /** Replaces the map inside the frame (undefined empties it). */
    setGraph(graph: SystemGraph | undefined) {
        this.graphSubscription?.unsubscribe();
        this.graphSubscription = undefined;
        if (this.graph) {
            this.container.removeChild(this.graph.container);
            this.graph.container.destroy({ children: true });
        }
        this.graph = graph;
        if (graph) {
            graph.container.position.set(1, 1);
            this.container.addChild(graph.container);
            this.graphSubscription = graph.routeChanged.subscribe(
                () => this.picked.next(graph));
        }
    }

    destroy() {
        this.setGraph(undefined);
        this.picked.complete();
        this.container.destroy({ children: true });
    }
}
