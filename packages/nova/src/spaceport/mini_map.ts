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
//    waypoint boxes). A multi-jump route is drawn strong green, clipped at
//    the box; a pick made here over it is the next jump (until the full
//    map's Done) and is drawn beside it, the route's first hop going pale
//    (route.ts RouteState.singleFirst; reference "Map keys, minimap routes
//    and ctrl-clicks (K4, M2, M3), wave 41"). No borders, ever.
//
// WHEN IT SHOWS (reference_experiments M1-M3, measured frame by frame on
// the original): it is a PEEK, not a toggle. Every `h` press shows it for
// 60 frames (2.0 s) at full brightness — MINI_MAP_PEEK_MS — and then fades
// out (MINI_MAP_FADE_MS); a second `h` while it is up does not close it, it
// starts the peek over.
// Neither Tab nor thrust shows it, and nothing shows it automatically after
// landing and taking off. (Whether the original shows it by itself during
// a real jump is untested; NovaJS shows nothing new for a jump, and a peek
// still running when the display world is rebuilt for the next system
// runs out there — see StarmapPlugin.)
//
// HIDDEN, IT TAKES NO INPUT (Matthew, 2026-11-23: "`h` map preview is
// clickable even when hidden. bug."; and after wave 10 measured it: "b
// seems like a bug that I don't care about reproducing"). This departs from
// the original on purpose: there a click where the hidden map sat still
// picks a system and shows it again for about 5-7 s after the fade
// (reference_experiments "M1 wave 10"); the "Hidden h-map ignores clicks"
// enhancement OFF restores that (MINI_MAP_ORIGINAL_CLICK_WINDOW_MS). Here, between peeks
// the minimap is not drawn and is out of the hit test altogether, so a
// click there reaches whatever is underneath (tap-targeting a ship or
// planet). Shown, the whole pane is UI, so a click on it never falls
// through to what is underneath; a click on a neighbour picks it as the
// single next jump and restarts the peek; shift-click and ctrl-click
// behave like a plain click; a drag that starts on the current system
// clears the destination (SystemGraphOptions.miniMap has the click
// rules). A pick is committed the moment it is made, through the very
// path the full map's Done takes (StarmapPlugin.commitRoute ->
// SetJumpRouteEvent -> setPlayerJumpRoute input record), so the route a
// peer simulates is the one this player's minimap shows.
//
// FADING OUT: when a peek ends, the map stops taking input at once and
// then fades linearly over MINI_MAP_FADE_MS, as the original's does.
//
// It is an overlay, not a dialog: it binds no MenuControls, the simulation
// keeps running, and every flight key still flies the ship.
import * as PIXI from 'pixi.js';
import { Subject, Subscription } from 'rxjs';
import { DEFAULT_ZOOM } from './starmap_viewport.js';
import { SystemGraph } from './system_graph.js';
import { enhancementEnabled } from '../enhancements.js';

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
/** How long one peek stays fully lit: the original's 60 frames at 30 fps
 * (reference_experiments "M1 wave 10"; wave 2's 66 frames ended mid-fade). */
export const MINI_MAP_PEEK_MS = 60 * 1000 / 30;
/**
 * How long the map takes to fade out once a peek ends, in ms: its alpha
 * falls linearly from 1 to 0 over this long, as the original's does (about
 * 16 frames at 30 fps, a near-constant brightness drop per frame;
 * reference_experiments "M1 wave 10"). It takes no input from the moment
 * the fade starts. It appears at full brightness at once: no fade-in.
 */
export const MINI_MAP_FADE_MS = 16 * 1000 / 30;

/**
 * How long after a peek BEGINS the ORIGINAL's hidden minimap still takes
 * clicks: somewhere between 6.8 and 9.3 s after the show, i.e. 4.4 to
 * 6.8 s after its last pixel faded (reference_experiments "M1 wave 10");
 * 8 s is inside both bounds. NovaJS only uses it with the "Hidden h-map
 * ignores clicks" enhancement OFF; ON (the default), the map takes clicks
 * only while it is shown.
 */
export const MINI_MAP_ORIGINAL_CLICK_WINDOW_MS = 8000;

/**
 * The map's opacity at `now` for a peek that ends (stops taking input)
 * at `until`: 1 during the peek, then a fade over `fadeMs`, then 0.
 */
export function miniMapAlpha(now: number, until: number,
    fadeMs = MINI_MAP_FADE_MS): number {
    if (now < until) {
        return 1;
    }
    if (now >= until + fadeMs) {
        return 0;
    }
    return 1 - (now - until) / fadeMs;
}

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
    /** The last {@link update}'s `active`. */
    private active = false;

    /**
     * @param now The display clock, in ms.
     * @param peekState When the current peek ends; shared with the owner.
     */
    constructor(private readonly now: () => number,
        private readonly peekState: MiniMapPeek = { until: -Infinity }) {
        this.container.name = 'MiniMap';
        this.container.visible = false;
        this.container.alpha = 0;
        this.container.eventMode = 'none';
        this.container.interactiveChildren = false;
        // The outline only: the space view shows through the pane.
        this.frame.lineStyle(1, MINI_MAP_FRAME_COLOR, 1, 0);
        this.frame.drawRect(0, 0, MINI_MAP_FRAME, MINI_MAP_FRAME);
        this.container.addChild(this.frame);
    }

    /** The graph on show, if one has been set. */
    get current(): SystemGraph | undefined {
        return this.graph;
    }

    /** Whether a peek is running: the map is on screen at full strength
     * and takes clicks (when active). A fade, if any, follows it. */
    get showing(): boolean {
        return this.now() < this.peekState.until;
    }

    /** Whether the map takes pointer input right now: active, with a map,
     * and a peek running — never while hidden or fading out. With the
     * "Hidden h-map ignores clicks" enhancement OFF, as the original's: for
     * {@link MINI_MAP_ORIGINAL_CLICK_WINDOW_MS} from the show, hidden or
     * not. */
    get takesInput(): boolean {
        if (!this.active || this.graph === undefined) {
            return false;
        }
        if (this.showing) {
            return true;
        }
        return !enhancementEnabled('enhMiniMapHiddenNoClicks')
            && this.now() < this.peekState.until - MINI_MAP_PEEK_MS
                + MINI_MAP_ORIGINAL_CLICK_WINDOW_MS;
    }

    /** Shows the map for {@link MINI_MAP_PEEK_MS} from now — `h`, or a
     * click on it while it is up. A peek already running (or fading)
     * starts over. */
    peek() {
        this.peekState.until = this.now() + MINI_MAP_PEEK_MS;
        this.update(this.active);
    }

    /**
     * Per frame. `active`: whether the minimap may be used at all — in
     * flight with nothing modal up. Inactive, it neither shows nor takes
     * clicks. Active, it is drawn during a peek and its fade-out
     * ({@link miniMapAlpha}) and takes clicks only during the peek; the
     * rest of the time it is invisible to the pointer, so clicks reach
     * what is underneath.
     */
    update(active: boolean) {
        this.active = active;
        const alpha = miniMapAlpha(this.now(), this.peekState.until);
        this.container.alpha = alpha;
        // 'none' takes it (and its children) out of PIXI's hit test even
        // while it is still drawn, fading.
        const input = this.takesInput;
        // Hidden but still clickable (the original's window, enhancement
        // off): kept in the scene at alpha 0, since PIXI's hit test skips
        // an invisible container.
        this.container.visible = active && this.graph !== undefined
            && (alpha > 0 || input);
        this.container.eventMode = input ? 'passive' : 'none';
        this.container.interactiveChildren = input;
    }

    /** Replaces the map inside the frame (undefined empties it). */
    setGraph(graph: SystemGraph | undefined) {
        this.graphSubscription?.unsubscribe();
        this.graphSubscription = undefined;
        this.graph?.destroy();
        this.graph = graph;
        if (graph) {
            graph.container.position.set(1, 1);
            this.container.addChild(graph.container);
            this.graphSubscription = graph.routeChanged.subscribe(
                () => this.picked.next(graph));
            // Shown, the whole pane takes the pointer; otherwise nothing
            // does. (update() already takes the hidden map out of the hit
            // test; this also covers a peek that ran out since the last
            // frame.)
            graph.container.hitArea = {
                contains: (x: number, y: number) =>
                    x >= 0 && y >= 0
                    && x < MINI_MAP_PANE.x && y < MINI_MAP_PANE.y
                    && this.takesInput,
            };
            // Any press that lands on it — a pick, a modified click, the
            // start of a drag — keeps it up for another peek.
            graph.container.on('pointerdown', () => this.peek());
        }
    }

    destroy() {
        this.setGraph(undefined);
        this.picked.complete();
        this.container.destroy({ children: true });
    }
}
