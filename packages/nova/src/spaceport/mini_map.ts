// The in-flight hyperspace minimap: what `h` (controls.json `smallMap`, the
// original's "Hyperspace Mode" key) shows over the space view, measured on
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
//    both captures: ~1.77 px per map unit; see MINI_MAP_ZOOM).
//  * The route is a thin green line; the current system is marked by its
//    cyan centre alone (no dashed ring, no selection brackets, no pinned
//    waypoint boxes).
//
// WHEN IT SHOWS (reference_experiments M1-M3, measured frame by frame on
// the original): it is a PEEK, not a toggle. Every `h` press shows it for
// 64-66 frames at 30 fps — MINI_MAP_PEEK_MS — and then it hides itself; a
// second `h` while it is up does not close it, it starts the 2.2 s over.
// Neither Tab nor thrust shows it, and nothing shows it automatically after
// landing and taking off. (Whether the original shows it by itself during
// a real jump is untested; NovaJS shows nothing new for a jump, and a peek
// still running when the display world is rebuilt for the next system
// runs out there — see StarmapPlugin.)
//
// CLICKS WORK WHILE IT IS HIDDEN. A click where it sits picks that system
// as the single next jump and shows it for another 2.2 s; shift-click and
// ctrl-click behave like a plain click; a drag that starts on the current
// system clears the destination (SystemGraphOptions.miniMap has the click
// rules). Hidden, only the systems' click spots take the pointer (see
// MiniMap.setGraph) so the rest of that corner still taps ships and
// planets; shown, the whole pane is UI, so a click on it never falls
// through to tap-targeting whatever is underneath. A pick is committed the
// moment it is made, through the very path the full map's Done takes
// (StarmapPlugin.commitRoute -> SetJumpRouteEvent -> setPlayerJumpRoute
// input record), so the route a peer simulates is the one this player's
// minimap shows.
//
// It is an overlay, not a dialog: it binds no MenuControls, the simulation
// keeps running, and every flight key still flies the ship.
import * as PIXI from 'pixi.js';
import { Subject, Subscription } from 'rxjs';
import { DEFAULT_ZOOM } from './starmap_viewport.js';
import { SystemGraph } from './system_graph.js';

/**
 * The map pane: the frame's inside. 480 px with the outline, as in the
 * 1920x1080 capture. In the original's 832x604 window the box is 208x206
 * at (414, 151) — the same top and the same 16 px gap to the status bar,
 * still ~1.77 px per map unit — so the original shrinks it with the
 * window; two data points don't pin that rule, and NovaJS lays the UI out
 * for 1920x1080, so the size stays fixed (reference_experiments R8 item 8).
 */
export const MINI_MAP_PANE = { x: 478, y: 478 };
/** The frame: the pane plus its 1px outline on every side. */
export const MINI_MAP_FRAME = MINI_MAP_PANE.x + 2;
/** The outline (cölr FloatingMap as measured; cölr is not plumbed through
 * the game data yet — see item_grid.ts gridDim/gridBright). */
export const MINI_MAP_FRAME_COLOR = 0x080808;
/**
 * The minimap's zoom over the laid-out map: the original's map scale,
 * ~1.77 px per map unit (Sol->Tichel is 195 px for 110 units on both
 * mini_map.png and the full-map captures) — the same scale the full map
 * opens at (starmap_viewport.ts DEFAULT_PX_PER_UNIT).
 */
export const MINI_MAP_ZOOM = DEFAULT_ZOOM;
/** The frame's top edge, in UI-logical pixels. */
export const MINI_MAP_TOP = 150;
/** Clear pixels between the frame's right edge and the status bar. */
export const MINI_MAP_STATUS_BAR_GAP = 16;
/** How long one peek lasts: the original's 66 frames at 30 fps. */
export const MINI_MAP_PEEK_MS = 66 * 1000 / 30;

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

/**
 * When the current peek ends, on the display clock (TimeResource ms). Its
 * own object so the owner can keep it across display-world rebuilds.
 */
export interface MiniMapPeek {
    until: number;
}

export class MiniMap {
    readonly container = new PIXI.Container();
    /** Emits the graph each time the player picks (or clears) a jump. */
    readonly picked = new Subject<SystemGraph>();
    private readonly frame = new PIXI.Graphics();
    private graph?: SystemGraph;
    private graphSubscription?: Subscription;

    /**
     * @param now The display clock, in ms.
     * @param peekState When the current peek ends; shared with the owner.
     */
    constructor(private readonly now: () => number,
        private readonly peekState: MiniMapPeek = { until: -Infinity }) {
        this.container.name = 'MiniMap';
        this.container.visible = false;
        this.container.alpha = 0;
        // The outline only: the space view shows through the pane.
        this.frame.lineStyle(1, MINI_MAP_FRAME_COLOR, 1, 0);
        this.frame.drawRect(0, 0, MINI_MAP_FRAME, MINI_MAP_FRAME);
        this.container.addChild(this.frame);
    }

    /** The graph on show, if one has been set. */
    get current(): SystemGraph | undefined {
        return this.graph;
    }

    /** Whether a peek is running (the map is on screen when active). */
    get showing(): boolean {
        return this.now() < this.peekState.until;
    }

    /** Shows the map for {@link MINI_MAP_PEEK_MS} from now — `h`, or a
     * click where it sits. A peek already running starts over. */
    peek() {
        this.peekState.until = this.now() + MINI_MAP_PEEK_MS;
        this.container.alpha = 1;
    }

    /**
     * Per frame. `active`: whether the minimap may be used at all — in
     * flight with nothing modal up. Inactive, it neither shows nor takes
     * clicks. Active and between peeks it is drawn fully transparent
     * (alpha 0: PIXI skips drawing it but still hit-tests it), so its
     * systems keep taking clicks.
     */
    update(active: boolean) {
        this.container.visible = active && this.graph !== undefined;
        this.container.alpha = this.showing ? 1 : 0;
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
            // Shown, the whole pane takes the pointer; hidden, only the
            // spots a click on a system would land on.
            graph.container.hitArea = {
                contains: (x: number, y: number) =>
                    x >= 0 && y >= 0
                    && x < MINI_MAP_PANE.x && y < MINI_MAP_PANE.y
                    && (this.showing || graph.hasSystemAt(x, y)),
            };
            // Any press that lands on it — a pick, a modified click, the
            // start of a drag — shows it again.
            graph.container.on('pointerdown', () => this.peek());
        }
    }

    destroy() {
        this.setGraph(undefined);
        this.picked.complete();
        this.container.destroy({ children: true });
    }
}
