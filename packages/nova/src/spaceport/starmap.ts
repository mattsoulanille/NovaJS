import { GameDate } from "novadatainterface/player_start_data";
import { SystemData } from "novadatainterface/system_data";
import * as PIXI from 'pixi.js';
import { Observable, Subject } from "rxjs";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { ControlEvent } from "../nova_plugin/controls_plugin.js";
import { displayName } from "../nova_plugin/display_name.js";
import { MissionMapMark, STANDARD_CARGO_NAMES } from "../nova_plugin/mission_logic.js";
import { isPort, systemIsInhabited } from "../nova_plugin/landable.js";
import { evaluateNCBTest } from "../nova_plugin/ncb.js";
import { legalStatusName } from "../nova_plugin/reputation.js";
import { LegalRecordsState } from "../nova_plugin/reputation_plugin.js";
import { Button } from "./button.js";
import { FindDialog } from "./find_dialog.js";
import { Menu } from "./menu.js";
import { MenuControls } from "./menu_controls.js";
import { MissionUniverse } from "./mission_universe.js";
import {
    Adjacency, adjacentSystems, buildAdjacency, cycleSingle, effectiveRoute,
    expandRoute, formatMapDate, hazardDescription, reconcileRouteState,
    RouteState, SamePlace,
} from "./route.js";
import {
    clickRadiusWorld, DragTracker, nearestTargetIndex, screenToWorld,
} from "./starmap_hit.js";


const GREY = 0x666666;
// System-dot colors, sampled off the original at 1:1 in
// ui_screenshots/original_macos_screenshots/map/govt_borders.png (see
// drawSystem for the rule each one encodes). All three share one black
// interior.
/** An EXPLORED system that has at least one port. */
export const SYSTEM_INHABITED_COLOR = 0x0000ff;
/** An EXPLORED system with no port. */
export const SYSTEM_UNINHABITED_COLOR = 0xc6c6c6;
/** A system the player has never entered — nothing is known about it. */
export const SYSTEM_UNEXPLORED_COLOR = 0x424242;
export const SYSTEM_INTERIOR_COLOR = 0x000000;
// Hypergate network links, drawn in a distinct cyan so the instant-travel
// hypergate routes read apart from the grey normal-jump hyperspace links.
const HYPERGATE_LINK_COLOR = 0x00cccc;
// Route colors (map/notes.txt): the multi-jump route is the STRONGER green
// line; the single-jump route is the WEAKER one.
const ROUTE_MULTI_COLOR = 0x00ff00;
const ROUTE_MULTI_WIDTH = 3;
const ROUTE_SINGLE_COLOR = 0x00b400;
const ROUTE_SINGLE_WIDTH = 1;
// Active-mission markers use the original game's own icons: the ORANGE
// cicn 15000 on active-mission destination/ship systems (mission_bbs/
// notes.txt) and the GREEN cicn 15001 on the destinations of the mission
// being viewed in the Mission BBS. The green art mirrors the orange (they
// point down-right and down-left respectively), so the two marks can flank
// a shared system from opposite sides. Placement in placeMarkIcon.
// Exported because the hypergate map (gate_map.ts) draws the same active
// marks on the same SystemGraph.
export const MISSION_MARK_ACTIVE_CICN = 'nova:15000';
const MISSION_MARK_VIEWED_CICN = 'nova:15001';
const SELECT_COLOR = 0x00ff00;
const LABEL_FONT_NAME = 'StarmapSystemLabel';
const LABEL_FONT_SIZE = 10;

// The scale at which system positions are laid out. Zoom is applied on top of
// this as a transform on the map container, so systems are only drawn once.
const BASE_SCALE = 2;
// How far the view can be zoomed relative to BASE_SCALE.
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.15;
// How far the arrow keys pan per press, in screen pixels.
const KEY_PAN_STEP = 40;
// Radius of a system's outer circle in laid-out coordinates.
const SYSTEM_RADIUS = 2.7 * BASE_SCALE;
// How close (in screen pixels) a click must be to a system to select it.
const CLICK_RADIUS = 12;

// Rendering every system name as its own PIXI.Text gives each label a
// distinct texture, which overwhelms the renderer's texture batching (the map
// dropped to ~4 FPS with 631 labels). A shared bitmap font lets all labels
// batch into a single draw call, and generating the glyph atlas once up front
// avoids the multi-hundred-ms rasterization hitch (which stalled the main
// thread long enough to desync the simulation) the first time the map
// rendered.
function installLabelFont(systems: SystemData[]) {
    // BitmapFont rasterizes glyphs through a DOM canvas. In a headless
    // context (Node unit/integration tests) there's no document, so skip the
    // atlas; label BitmapText is likewise skipped when the font is absent.
    // Clicks resolve from clickTargets' coordinates, not the labels, so
    // hit-testing is unaffected.
    if (typeof document === 'undefined') {
        return;
    }
    const chars = new Set<string>([' ']);
    for (const system of systems) {
        for (const char of system.name) {
            chars.add(char);
        }
    }
    if (PIXI.BitmapFont.available[LABEL_FONT_NAME]) {
        PIXI.BitmapFont.uninstall(LABEL_FONT_NAME);
    }
    PIXI.BitmapFont.from(LABEL_FONT_NAME, {
        fontFamily: 'Geneva',
        fontSize: LABEL_FONT_SIZE,
        fill: 0xffffff,
    }, {
        chars: [...chars],
        // Rasterize at double size so labels stay reasonably crisp when the
        // map is zoomed in.
        resolution: 2,
    });
}

/**
 * Whether a system exists for the player according to its visibility NCB
 * test, evaluated against the player's control bits. Nova swaps between
 * alternate copies of a system (stacked at the same map position) by
 * giving each a different visibility expression, e.g. the four Sols
 * at (0,0).
 */
function systemVisible(system: SystemData,
    bits: ReadonlySet<number>): boolean {
    try {
        return evaluateNCBTest(system.visibility ?? '', {
            getBit: bit => bits.has(bit),
        });
    } catch (e) {
        // Show systems with malformed visibility expressions rather than
        // hiding parts of the map.
        console.warn(`Bad visibility NCB test for ${system.id}: ${e}`);
        return true;
    }
}

/**
 * Computes the system-to-system hypergate links to overlay on the map from a
 * spöb -> system index and a per-gate destination lookup. Pure (no PIXI, no
 * async) so it is unit-testable. `gateDestinations` maps a hypergate spöb
 * global id to the spöb global ids it links to; non-hypergate spöbs are absent.
 */
export function computeHypergateSystemLinks(
    systemOfSpob: Map<string, string>,
    gateDestinations: Map<string, string[]>): [string, string][] {
    const links: [string, string][] = [];
    for (const [spob, destinations] of gateDestinations) {
        const fromSystem = systemOfSpob.get(spob);
        if (!fromSystem) {
            continue;
        }
        for (const dest of destinations) {
            const toSystem = systemOfSpob.get(dest);
            if (toSystem) {
                links.push([fromSystem, toSystem]);
            }
        }
    }
    return links;
}

/** The map spot a system occupies: its exact map coordinates. */
function placeKey(position: readonly number[]): string {
    return `${position[0]},${position[1]}`;
}

/**
 * Picks the ONE system each map spot should draw, label and answer clicks
 * for. Nova stacks copies of a system at the same coordinates and swaps
 * between them with control bits, so several can share a spot; NCB
 * visibility filtering usually collapses a stack to one already, and this
 * handles what is left (a plugin system with blank visibility stacked on a
 * stock one, or the player standing in a copy their bits say is hidden —
 * that one is kept on the map deliberately).
 *
 * THE CURRENT SYSTEM ALWAYS REPRESENTS ITS OWN SPOT. Clicking the spot you
 * are standing in must pin the system you are standing IN: pinning a
 * different id for the same place asks the router for a path from a system
 * to itself, which it answers by flying out to a neighbour and back — the
 * pilot enters the same system twice (Matthew's playtest, 2026-08-17).
 * Otherwise a system reachable from the current one is preferred over an
 * unreachable one, breaking ties by data order.
 *
 * Pure (no PIXI) so it is unit-testable.
 */
export function representativeSystems<
    T extends { id: string, position: readonly number[] }>(
        systems: readonly T[], currentSystem: string,
        reachable: (id: string) => boolean): T[] {
    const byPosition = new Map<string, T>();
    for (const system of systems) {
        const key = placeKey(system.position);
        const existing = byPosition.get(key);
        if (!existing || system.id === currentSystem) {
            byPosition.set(key, system);
            continue;
        }
        if (existing.id === currentSystem) {
            continue;
        }
        // Keep the existing pick unless this one is reachable and the
        // existing one isn't.
        if (!reachable(existing.id) && reachable(system.id)) {
            byPosition.set(key, system);
        }
    }
    return [...byPosition.values()];
}

/**
 * The color of a system's dot on the map. TWO independent questions, in this
 * order — both measured on the original at 1:1 in
 * ui_screenshots/original_macos_screenshots/map/govt_borders.png, whose 40
 * dots were matched back to sÿst ids through the map's own layout:
 *
 *  1. HAS THE PLAYER EXPLORED IT? Every one of the 22 dark grey (#424242)
 *     dots is an unlabeled system, and every labeled system is either blue
 *     or light grey. Unexplored systems are drawn dim whatever is in them:
 *     Sirius (2 ports), Aldebaran (3) and Gefjon (2) are all #424242 there.
 *     This is what keeps a "secret" installation secret — an inhabited
 *     station in a system the player has never entered does not advertise
 *     itself on the map.
 *
 *  2. IS IT INHABITED? An explored system is BLUE iff it contains at least
 *     one PORT — a stellar that is landable (spöb Flags 0x0001) AND not
 *     uninhabited (0x0020 clear); see landable.ts isPort, which is also
 *     what fills the "Ports:" readout. All 15 blue dots have >= 1 port and
 *     all 3 light grey (#c6c6c6) ones have none. Landability alone is NOT
 *     enough: HJG-1034's UHP-0474 and Procyon's UHP-1002 are both landable
 *     but flagged uninhabited, and both systems draw light grey.
 *
 * The stock data leaves one corner of rule 2 unwitnessed: four Wraith
 * systems (sÿst 510/521/582/593) hold a stellar that is inhabited but NOT
 * landable, and no reference screenshot covers them. They draw grey here,
 * on the reading that the map is showing ports.
 */
export function systemDotColor(explored: boolean,
    inhabited: boolean): number {
    if (!explored) {
        return SYSTEM_UNEXPLORED_COLOR;
    }
    return inhabited ? SYSTEM_INHABITED_COLOR : SYSTEM_UNINHABITED_COLOR;
}

function drawSystem(system: SystemData, graphics: PIXI.Graphics,
    x: number, y: number, explored: boolean, inhabited: boolean) {
    const outColor = systemDotColor(explored, inhabited);
    graphics.lineStyle(1, outColor);
    graphics.beginFill(outColor)
    graphics.drawCircle(x, y, SYSTEM_RADIUS);
    graphics.beginFill(SYSTEM_INTERIOR_COLOR);
    graphics.drawCircle(x, y, 1.8 * BASE_SCALE);
    graphics.endFill();
}

export interface SystemGraphOptions {
    /**
     * Hypergate lanes to overlay (pairs of system global ids). The REGULAR
     * starmap does not show hypergate lanes (matching the original game);
     * only the hypergate transit map (GateMap) passes these.
     */
    gateLinks?: [string, string][];
    /**
     * Destination-picker mode: clicking is restricted to these systems, and a
     * click selects (highlights) the system instead of plotting a route. Used
     * by the hypergate map to pick one of the gate's linked neighbors.
     */
    selectable?: Set<string>;
    size?: { x: number, y: number };
    /**
     * The player's control bits for NCB visibility filtering: systems whose
     * visibility expression fails against these bits aren't drawn, clicked,
     * linked, or routed through. Defaults to no bits (a new pilot).
     */
    playerBits?: ReadonlySet<number>;
    /**
     * Systems to mark for the player's active missions (mission_logic
     * missionMapMarks): orange destination arrows plus optional yellow
     * special-ship-system arrows. Purely decorative — an additive overlay
     * that never affects clicking, linking, or routing. Marks on systems the
     * player hasn't explored still render (mission_bbs/notes.txt).
     */
    missionMarks?: MissionMapMark[];
    /**
     * Destination systems of the mission currently being viewed in the
     * Mission BBS, marked with GREEN arrows. May share systems with
     * missionMarks (both arrows show).
     */
    viewedMarks?: MissionMapMark[];
    /**
     * The original game's mission-mark icons (cicn 15000 orange / 15001
     * green), preloaded by the owning Starmap. Omitted only in tests /
     * standalone graphs, in which case no mission marks are drawn.
     */
    missionMarkTextures?: {
        active: PIXI.Texture,
        viewed: PIXI.Texture,
    };
    /**
     * The government border color for a system (Show Borders), or null for
     * no blob. Injected so the graph itself stays free of async data loads.
     */
    govtColorOf?: (system: SystemData) => number | null;
    /**
     * Whether a system contains at least one port, deciding the blue dot
     * (see drawSystem). Injected — like govtColorOf — because answering it
     * needs the spöb data the graph deliberately never loads itself; every
     * caller passes `system => systemIsInhabited(system.planets, getPlanet)`
     * over its MissionUniverse. Defaults to "no port", so a graph built
     * without spöb data draws an honestly grey galaxy rather than guessing.
     */
    isSystemInhabited?: (system: SystemData) => boolean;
    /**
     * Whether the player has explored (entered) a system; unexplored ones
     * draw dim (see drawSystem). Defaults to "explored", which is what the
     * maps that have no exploration record of their own (the rollback
     * screen's replay map) want.
     */
    isSystemExplored?: (systemId: string) => boolean;
}

export class SystemGraph {
    readonly container = new PIXI.Container();
    /** Emits the plainly-clicked system (route mode), for the properties
     * panel. */
    readonly infoSelection = new Subject<string>();
    /** Emits whenever the pinned/single route state changes (route mode). */
    readonly routeChanged = new Subject<void>();

    // Links and the highlighted route live on separate graphics so that
    // selecting a route only redraws the route, not the whole galaxy.
    private readonly linkGraphics: PIXI.Graphics;
    private readonly routeGraphics: PIXI.Graphics;
    private readonly borderGraphics: PIXI.Graphics;
    private readonly links: [SystemData, SystemData][];
    private readonly systems: Map<string, SystemData>;
    /** Adjacency over the visible systems, for route planning. */
    private readonly adj: Adjacency;
    // Zoom is a transform applied on top of BASE_SCALE. Panning and zooming
    // never redraw the systems; they only move/scale mapContainer.
    private zoom = 1;
    // The click-vs-drag state machine (starmap_hit.ts). Decides when a pointer
    // gesture has moved far enough to be a pan rather than a click, so the tap
    // handler can tell a click apart from the end of a pan. A physical click
    // jitters a pixel or two between press and release; treating that as a
    // drag used to swallow the tap (click once, nothing; click again without
    // moving, it registers), which the tracker's deadzone fixes.
    private readonly drag = new DragTracker();
    // Route mode state (see route.ts): pinned multi-jump waypoints, the
    // single-jump destination, and the system whose properties are shown.
    private pinned: string[] = [];
    private single?: string;
    private infoSelected?: string;
    private routes: Map<string, string[]>;
    /** Every system's "place" (name + map coordinates), for {@link
     * samePlace}: stacked duplicates of one system share it. */
    private placeById: Map<string, string>;
    // One representative system per map position, used for drawing circles and
    // labels and for resolving clicks. Nova swaps between multiple copies of a
    // system (at the same coordinates) with NCBs, so several systems can be
    // stacked on one spot; only one of them should respond to the map.
    private clickTargets: { system: SystemData, x: number, y: number }[];
    private mapContainer: PIXI.Container;
    private maskedContainer: PIXI.Container;
    // Bounding box of all systems in laid-out (BASE_SCALE) coordinates.
    private worldBounds: { minX: number, minY: number, maxX: number, maxY: number };

    // Hypergate links between systems (each a pair of system global ids).
    // Drawn in a distinct style from the normal grey hyperspace links.
    private readonly gateLinks: [SystemData, SystemData][];
    // Destination-picker mode (see SystemGraphOptions.selectable).
    private readonly selectable?: Set<string>;
    // Active-mission destination / ship-syst markers (decorative overlay).
    private readonly missionMarks: MissionMapMark[];
    private readonly viewedMarks: MissionMapMark[];
    // The original game's mission-mark icons (cicn 15000/15001), or
    // undefined when the graph is built without them (tests).
    private readonly missionMarkTextures?: {
        active: PIXI.Texture, viewed: PIXI.Texture,
    };
    /** The picked system in destination-picker mode, if any. */
    selectedSystem?: string;
    private size: { x: number, y: number };
    // The two questions drawSystem asks about each dot. Injected; see
    // SystemGraphOptions.
    private readonly isSystemInhabited: (system: SystemData) => boolean;
    private readonly isSystemExplored: (systemId: string) => boolean;

    constructor(systems: SystemData[], private currentSystem: string,
        options: SystemGraphOptions = {}) {
        const gateLinks = options.gateLinks ?? [];
        const playerBits = options.playerBits ?? new Set<number>();
        this.selectable = options.selectable;
        this.missionMarks = options.missionMarks ?? [];
        this.viewedMarks = options.viewedMarks ?? [];
        this.missionMarkTextures = options.missionMarkTextures;
        this.isSystemInhabited = options.isSystemInhabited ?? (() => false);
        this.isSystemExplored = options.isSystemExplored ?? (() => true);
        const size = this.size = options.size ?? { x: 456, y: 419 };
        // NCB-hidden systems don't exist for the player: they aren't drawn,
        // clicked, linked, or routed through. The current system is always
        // kept so the map stays usable even if the player is somewhere the
        // visibility data says shouldn't exist.
        const visibleSystems = systems.filter(
            s => s.id === currentSystem || systemVisible(s, playerBits));
        this.systems = new Map(visibleSystems.map(s => [s.id, s]));
        // Built from EVERY system, not just the visible ones: a pin made
        // under different control bits can name a copy that is hidden now,
        // and "is that pin the place I'm standing in?" still has to answer
        // yes (see SamePlace in route.ts).
        this.placeById = new Map(systems.map(
            s => [s.id, `${s.name}@${placeKey(s.position)}`]));
        this.adj = buildAdjacency(visibleSystems);
        this.routes = this.computeShortestPaths();
        this.clickTargets = this.pickRepresentativeSystems(visibleSystems);

        this.linkGraphics = new PIXI.Graphics();
        this.routeGraphics = new PIXI.Graphics();
        this.borderGraphics = new PIXI.Graphics();
        this.borderGraphics.visible = false;

        this.mapContainer = new PIXI.Container();
        // Borders sit under everything; the route overlays the links.
        this.mapContainer.addChild(this.borderGraphics);
        this.mapContainer.addChild(this.linkGraphics);
        this.mapContainer.addChild(this.routeGraphics);

        this.maskedContainer = new PIXI.Container();
        const mask = new PIXI.Graphics();
        mask.beginFill(0xff0000);
        mask.drawRect(0, 0, size.x, size.y);
        mask.endFill();
        this.maskedContainer.mask = mask;
        this.container.addChild(mask);

        this.maskedContainer.addChild(this.mapContainer);
        this.container.addChild(this.maskedContainer);

        // Capture pointer and wheel events over the whole map area. Clicks on
        // systems are resolved manually in onTap by finding the nearest system
        // to the pointer: with one interactive object instead of hundreds, the
        // event system stays fast, and a label drawn over a neighboring system
        // (e.g. Murasaki's label over Fomalhaut) can't swallow that system's
        // clicks like per-circle hit-testing allowed.
        this.container.eventMode = 'static';
        this.container.hitArea = new PIXI.Rectangle(0, 0, size.x, size.y);
        this.container.cursor = 'pointer';
        const onDragStart = this.onDragStart.bind(this);
        const onDragMove = this.onDragMove.bind(this);
        const onDragEnd = this.onDragEnd.bind(this);
        this.container
            .on('pointerdown', onDragStart)
            .on('pointerup', onDragEnd)
            .on('pointerupoutside', onDragEnd)
            .on('pointermove', onDragMove)
            .on('pointertap', this.onTap.bind(this))
            .on('wheel', this.onWheel.bind(this));

        this.links = [...this.getUniqueLinks()];
        // Resolve hypergate link ids to the visible systems they connect.
        // Links touching an NCB-hidden system (not in this.systems) are
        // dropped, like normal jump links.
        this.gateLinks = [];
        const seenGateLink = new Set<string>();
        for (const [a, b] of gateLinks) {
            const sa = this.systems.get(a);
            const sb = this.systems.get(b);
            if (!sa || !sb || a === b) {
                continue;
            }
            const key = [a, b].sort().join('<->');
            if (seenGateLink.has(key)) {
                continue;
            }
            seenGateLink.add(key);
            this.gateLinks.push([sa, sb]);
        }

        // All circles are baked into a single Graphics and all labels share
        // one bitmap font texture, so drawing the whole galaxy takes a couple
        // of draw calls instead of ~1300 display objects with distinct
        // textures. Pan and zoom are transforms on mapContainer, so nothing
        // here is ever redrawn per frame.
        installLabelFont(this.clickTargets.map(t => t.system));
        // Labels render only when the bitmap font is available (i.e. not in a
        // headless test context, where installLabelFont is a no-op).
        const fontReady = !!PIXI.BitmapFont.available[LABEL_FONT_NAME];
        const circleGraphics = new PIXI.Graphics();
        const labelContainer = new PIXI.Container();
        for (const { system, x, y } of this.clickTargets) {
            drawSystem(system, circleGraphics, x, y,
                this.isSystemExplored(system.id),
                this.isSystemInhabited(system));
            // NOTE: the original also hides a system's NAME until it has been
            // explored (in the reference screenshot exactly the 18 labeled
            // systems are the non-dim ones). Labels are still drawn for
            // everything here; only the dot color follows exploration so far.
            if (fontReady) {
                const label = new PIXI.BitmapText(displayName(system.name), {
                    fontName: LABEL_FONT_NAME,
                    fontSize: LABEL_FONT_SIZE,
                });
                label.position.set(x + 10, y);
                label.anchor.set(0, 0.5);
                labelContainer.addChild(label);
            }
        }
        this.mapContainer.addChild(circleGraphics);
        this.mapContainer.addChild(labelContainer);
        this.drawMissionMarks();

        this.worldBounds = this.computeWorldBounds();

        if (options.govtColorOf) {
            this.drawBorders(options.govtColorOf);
        }
        this.drawLinks();
        if (this.selectable) {
            this.drawSelection();
        } else {
            this.drawRoute();
        }
        this.applyZoom();
    }

    /** The map spot each system is drawn on and clicked at: see
     * {@link representativeSystems}. */
    private pickRepresentativeSystems(systems: SystemData[]) {
        return representativeSystems(systems, this.currentSystem,
            id => this.routes.has(id)).map(system => {
                const [x, y] = this.scalePos(system.position);
                return { system, x, y };
            });
    }

    /** Centers the current system in the viewport at the current zoom. */
    center() {
        this.centerOn(this.currentSystem);
    }

    /**
     * Re-targets the "current system" (the dashed ring, and the origin the
     * route overlay is expanded from) without rebuilding the graph. For
     * viewers that step through many locations over one galaxy — the
     * title screen's rollback view walks a pilot's checkpoints this way.
     * Ignored for a system not on this map (NCB-hidden). Route mode only.
     */
    setCurrentSystem(systemId: string) {
        if (!this.systems.has(systemId) || systemId === this.currentSystem) {
            return;
        }
        this.currentSystem = systemId;
        this.drawRoute();
    }

    /** Whether `systemId` is drawn on this map (visible under its bits). */
    hasSystem(systemId: string): boolean {
        return this.systems.has(systemId);
    }

    /** Centers any system in the viewport at the current zoom. */
    centerOn(systemId: string) {
        const system = this.systems.get(systemId);
        if (system) {
            const pos = this.scalePos(system.position);
            this.mapContainer.position.set(
                this.size.x / 2 - pos[0] * this.zoom,
                this.size.y / 2 - pos[1] * this.zoom,
            );
            this.clampPosition();
        }
    }

    // --- Route mode (the regular starmap) ---

    /** Loads route state (pinned waypoints + single-jump destination). */
    setRouteState(state: RouteState) {
        this.pinned = [...state.pinned];
        this.single = state.single;
        this.drawRoute();
    }

    getRouteState(): RouteState {
        return { pinned: [...this.pinned], single: this.single };
    }

    /** The route hyperspace jumps follow (multi-jump takes precedence). */
    getEffectiveRoute(): string[] {
        return effectiveRoute(this.adj, this.currentSystem,
            this.getRouteState(), this.samePlace);
    }

    get adjacency(): Adjacency {
        return this.adj;
    }

    /**
     * Whether two system ids are the same PLACE — stacked duplicates of one
     * system (see SamePlace in route.ts). An arrow function so it can be
     * handed to the route helpers as a plain predicate.
     */
    readonly samePlace: SamePlace = (a, b) => {
        if (a === b) {
            return true;
        }
        const place = this.placeById.get(a);
        return place !== undefined && place === this.placeById.get(b);
    };

    get hasRoute(): boolean {
        return this.pinned.length > 0 || this.single !== undefined;
    }

    /** The system whose properties the panel shows. */
    get infoSystem(): string | undefined {
        return this.infoSelected;
    }

    clearRoute() {
        this.pinned = [];
        this.single = undefined;
        this.routeChanged.next();
        this.drawRoute();
    }

    /** Tab: cycles the single-jump route through the current system's
     * neighbours (through an "off" slot to clear it). */
    cycleSingleRoute(direction = 1) {
        if (this.selectable) {
            return;
        }
        const neighbours = adjacentSystems(this.adj, this.currentSystem);
        this.single = cycleSingle(neighbours, this.single, direction);
        if (this.single !== undefined) {
            this.selectForInfo(this.single);
        }
        this.routeChanged.next();
        this.drawRoute();
    }

    /**
     * Selects (and centers on) a system by name for the Find button.
     * Exact match first, then a unique prefix match. Returns the id, or
     * undefined if no match.
     */
    findByName(name: string): string | undefined {
        const wanted = name.trim().toLowerCase();
        if (!wanted) {
            return undefined;
        }
        let prefixMatch: SystemData | undefined;
        let prefixMatches = 0;
        for (const { system } of this.clickTargets) {
            const candidate = displayName(system.name).toLowerCase();
            if (candidate === wanted) {
                this.selectForInfo(system.id);
                this.centerOn(system.id);
                return system.id;
            }
            if (candidate.startsWith(wanted)) {
                prefixMatch = system;
                prefixMatches++;
            }
        }
        if (prefixMatch && prefixMatches === 1) {
            this.selectForInfo(prefixMatch.id);
            this.centerOn(prefixMatch.id);
            return prefixMatch.id;
        }
        return undefined;
    }

    /** Shows or hides the government border overlay. */
    setBordersShown(shown: boolean) {
        this.borderGraphics.visible = shown;
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
        const oldZoom = this.zoom;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
        if (newZoom === oldZoom) {
            return;
        }
        // Keep the world point under (centerX, centerY) stationary on screen.
        const pos = this.mapContainer.position;
        const worldX = (centerX - pos.x) / oldZoom;
        const worldY = (centerY - pos.y) / oldZoom;
        this.zoom = newZoom;
        pos.set(centerX - worldX * newZoom, centerY - worldY * newZoom);
        this.applyZoom();
    }

    private applyZoom() {
        this.mapContainer.scale.set(this.zoom);
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
        const left = b.minX * this.zoom;
        const right = b.maxX * this.zoom;
        const top = b.minY * this.zoom;
        const bottom = b.maxY * this.zoom;

        // Clamp so at least `margin` px of the galaxy stays on each edge.
        const minPosX = margin - right;
        const maxPosX = this.size.x - margin - left;
        const minPosY = margin - bottom;
        const maxPosY = this.size.y - margin - top;
        pos.x = Math.min(maxPosX, Math.max(minPosX, pos.x));
        pos.y = Math.min(maxPosY, Math.max(minPosY, pos.y));
    }

    private onDragStart(event: PIXI.FederatedPointerEvent) {
        this.drag.down(event.pointerId, event.global.x, event.global.y);
    }

    private onDragMove(event: PIXI.FederatedPointerEvent) {
        const delta =
            this.drag.move(event.pointerId, event.global.x, event.global.y);
        if (delta) {
            this.pan(delta.dx, delta.dy);
        }
    }

    private onDragEnd(event: PIXI.FederatedPointerEvent) {
        // The tracker keeps its `dragged` flag set until the next pointerdown
        // so onTap (which fires right after pointerup) can tell a click apart
        // from the end of a pan.
        this.drag.up(event.pointerId);
    }

    private onWheel(event: PIXI.FederatedWheelEvent) {
        const local = event.getLocalPosition(this.container);
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        this.zoomBy(factor, local.x, local.y);
    }

    private onTap(event: PIXI.FederatedPointerEvent) {
        // Ignore taps that were actually the end of a drag.
        if (this.drag.dragged) {
            return;
        }
        const local = event.getLocalPosition(this.container);
        const system = this.systemAt(local.x, local.y);
        if (system) {
            this.onClickSystem(system.id, event.shiftKey);
        }
    }

    /**
     * Finds the system nearest to a point in viewport coordinates, or
     * undefined if none is within clicking distance.
     */
    private systemAt(viewX: number, viewY: number): SystemData | undefined {
        const pos = this.mapContainer.position;
        const [worldX, worldY] =
            screenToWorld(viewX, viewY, pos.x, pos.y, this.zoom);
        // Accept clicks within CLICK_RADIUS on screen, but never make the
        // target smaller than the drawn circle.
        const radius = clickRadiusWorld(this.zoom, SYSTEM_RADIUS, CLICK_RADIUS);
        const i = nearestTargetIndex(this.clickTargets, worldX, worldY, radius);
        return i < 0 ? undefined : this.clickTargets[i].system;
    }

    private selectForInfo(system: string) {
        this.infoSelected = system;
        this.infoSelection.next(system);
        this.drawRoute();
    }

    private onClickSystem(system: string, shiftKey: boolean) {
        if (this.selectable) {
            // Destination-picker mode: only the offered systems respond, and
            // clicking one selects it (clicking again deselects).
            if (!this.selectable.has(system)) {
                return;
            }
            this.selectedSystem =
                this.selectedSystem === system ? undefined : system;
            this.drawSelection();
            return;
        }
        if (shiftKey) {
            // Shift-click appends the system to the multi-jump route as a
            // pinned waypoint (or unpins it). Gaps between pins auto-fill
            // with the shortest path when the route is expanded — the only
            // auto-routing there is (map/notes.txt).
            if (system !== this.currentSystem) {
                this.pinned = this.pinned.includes(system)
                    ? this.pinned.filter(p => p !== system)
                    : [...this.pinned, system];
                this.routeChanged.next();
            }
        } else if (adjacentSystems(this.adj, this.currentSystem)
            .includes(system)) {
            // A plain click on an adjacent system sets (or toggles off) the
            // single-jump route. Clicking anything else only inspects it.
            this.single = this.single === system ? undefined : system;
            this.routeChanged.next();
        }
        this.selectForInfo(system);
    }

    /**
     * Draws the destination-picker overlay on the route layer: a ring around
     * each offered system, and a filled highlight on the picked one.
     */
    private drawSelection() {
        this.routeGraphics.clear();
        if (!this.selectable) {
            return;
        }
        for (const id of this.selectable) {
            const system = this.systems.get(id);
            if (!system) {
                continue;
            }
            const [x, y] = this.scalePos(system.position);
            const picked = id === this.selectedSystem;
            this.routeGraphics.lineStyle(picked ? 2 : 1,
                picked ? 0x00ff00 : HYPERGATE_LINK_COLOR);
            this.routeGraphics.drawCircle(x, y, SYSTEM_RADIUS + 3);
        }
    }

    private getUniqueLinks() {
        const linksMap = new Map<string, [SystemData, SystemData]>();
        for (const [source, sourceSystem] of this.systems) {
            for (const dest of sourceSystem.links) {
                const linkEntry = [source, dest].sort().join('<->');
                if (this.systems.has(dest)) {
                    linksMap.set(linkEntry, [sourceSystem, this.systems.get(dest)!]);
                }
            }
        }
        return linksMap.values();
    }

    private computeWorldBounds() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const system of this.systems.values()) {
            const [x, y] = this.scalePos(system.position);
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

    private scalePos(pos: [number, number]): [number, number] {
        return pos.map(p => p * BASE_SCALE) as [number, number];
    }

    /**
     * Draws the government border overlay (Show Borders): a soft blob of the
     * owning government's color around each governed system, like the
     * original's territory shading (map/govt_borders.png). Baked once into
     * its own layer and simply hidden until toggled on.
     */
    private drawBorders(govtColorOf: (system: SystemData) => number | null) {
        // Two concentric translucent circles per system approximate the
        // original's soft-edged blobs; neighbors overlap into contiguous
        // territory. Colors are dimmed toward the original's deep muted
        // shading (govt_borders.png) — full-strength gövt colors (including
        // white ones) wash out the map.
        const dim = (color: number) =>
            (((color >> 16 & 0xff) * 0.55) & 0xff) << 16
            | (((color >> 8 & 0xff) * 0.55) & 0xff) << 8
            | ((color & 0xff) * 0.55) & 0xff;
        for (const { system, x, y } of this.clickTargets) {
            const color = govtColorOf(system);
            if (color === null) {
                continue;
            }
            this.borderGraphics.lineStyle(0);
            this.borderGraphics.beginFill(dim(color), 0.30);
            this.borderGraphics.drawCircle(x, y, 34 * BASE_SCALE);
            this.borderGraphics.endFill();
            this.borderGraphics.beginFill(dim(color), 0.32);
            this.borderGraphics.drawCircle(x, y, 20 * BASE_SCALE);
            this.borderGraphics.endFill();
        }
    }

    /**
     * Draws the active-mission markers using the original game's own cicn
     * icons: cicn 15000 (orange) on active-mission systems and cicn 15001
     * (green) on the destinations of the mission being viewed in the BBS
     * (mission_bbs/notes.txt). Additive and decorative: baked into the map
     * container like the circles, so the sprites pan/zoom with them and
     * never intercept clicks. Marks whose system is NCB-hidden (not on this
     * map) are skipped; marks on unexplored systems still render. When no
     * icons were preloaded (standalone/test graphs), nothing is drawn.
     */
    private drawMissionMarks() {
        const textures = this.missionMarkTextures;
        if (!textures) {
            return;
        }
        if (this.missionMarks.length === 0 && this.viewedMarks.length === 0) {
            return;
        }
        const container = new PIXI.Container();
        for (const mark of this.missionMarks) {
            // The orange icon points DOWN-RIGHT (tip at its lower-right
            // corner): it sits above-left of the system dot, aimed at it
            // (mission_bbs/accepted_un_mission_orange_mark...png).
            this.placeMarkIcon(container, mark.systemId, textures.active, 1);
        }
        for (const mark of this.viewedMarks) {
            // The green icon is the mirrored art pointing DOWN-LEFT (tip at
            // its lower-left corner): it sits above-right of the dot, so
            // both icons stay legible when a system has an active AND a
            // viewed mission on it (mission_bbs/notes.txt,
            // selected_mission_destination_green_mark.png).
            this.placeMarkIcon(container, mark.systemId, textures.viewed, 0);
        }
        this.mapContainer.addChild(container);
    }

    /** Places one mission-mark cicn sprite beside a system, its pointed tip
     * anchored just outside the system circle on the upper diagonal it aims
     * along. `tipAnchorX` is the tip's corner within the art: 1 = lower-right
     * (the orange down-right arrow, placed above-left of the dot), 0 =
     * lower-left (the green down-left arrow, placed above-right).
     * Non-interactive and unscaled, so it reads at its native size. */
    private placeMarkIcon(container: PIXI.Container, systemId: string,
        texture: PIXI.Texture, tipAnchorX: number) {
        const system = this.systems.get(systemId);
        if (!system) {
            return;
        }
        const [x, y] = this.scalePos(system.position);
        const sprite = new PIXI.Sprite(texture);
        sprite.eventMode = 'none';
        sprite.anchor.set(tipAnchorX, 1);
        const dx = tipAnchorX === 1 ? -SYSTEM_RADIUS : SYSTEM_RADIUS;
        sprite.position.set(x + dx, y - SYSTEM_RADIUS);
        container.addChild(sprite);
    }

    private drawLinks() {
        this.linkGraphics.clear();
        for (const [source, dest] of this.links) {
            this.drawLink(this.linkGraphics, source, dest);
        }
        // Hypergate network links, over the normal links in a distinct color
        // so the instant-travel routes are legible as their own layer.
        for (const [source, dest] of this.gateLinks) {
            this.drawLink(this.linkGraphics, source, dest,
                HYPERGATE_LINK_COLOR, 1);
        }
    }

    /**
     * Draws the route overlay: the WEAK single-jump line, the STRONG
     * multi-jump line over it, pinned-waypoint boxes, the current system's
     * ring, and the properties-selection brackets.
     */
    private drawRoute() {
        if (this.selectable) {
            return;
        }
        const g = this.routeGraphics;
        g.clear();

        // Single-jump route: the weaker green line.
        if (this.single !== undefined) {
            const from = this.systems.get(this.currentSystem);
            const to = this.systems.get(this.single);
            if (from && to) {
                this.drawLink(g, from, to,
                    ROUTE_SINGLE_COLOR, ROUTE_SINGLE_WIDTH);
            }
        }

        // Multi-jump route: the stronger green line, over the single one.
        const multi = expandRoute(this.adj, this.currentSystem, this.pinned,
            this.samePlace);
        let prev = this.systems.get(this.currentSystem);
        for (const system of multi.map(id => this.systems.get(id))) {
            if (system) {
                if (prev) {
                    this.drawLink(g, prev, system,
                        ROUTE_MULTI_COLOR, ROUTE_MULTI_WIDTH);
                }
                prev = system;
            }
        }

        // Pinned waypoints: a small green box marks each explicitly
        // selected system (they always stay in the route).
        for (const id of this.pinned) {
            const system = this.systems.get(id);
            if (!system) {
                continue;
            }
            const [x, y] = this.scalePos(system.position);
            const r = SYSTEM_RADIUS + 2;
            g.lineStyle(1, ROUTE_MULTI_COLOR);
            g.drawRect(x - r, y - r, 2 * r, 2 * r);
        }

        // The current system: a dashed green ring (the original's marker).
        const current = this.systems.get(this.currentSystem);
        if (current) {
            const [x, y] = this.scalePos(current.position);
            const r = SYSTEM_RADIUS + 2.5;
            g.lineStyle(1.2, SELECT_COLOR);
            const segments = 8;
            for (let i = 0; i < segments; i++) {
                const a0 = (i * 2 * Math.PI) / segments;
                const a1 = a0 + Math.PI / segments;
                g.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0));
                g.arc(x, y, r, a0, a1);
            }
        }

        // The inspected system: green corner brackets around it.
        if (this.infoSelected !== undefined
            && this.infoSelected !== this.currentSystem) {
            const system = this.systems.get(this.infoSelected);
            if (system) {
                const [x, y] = this.scalePos(system.position);
                const r = SYSTEM_RADIUS + 3;
                const arm = 3;
                g.lineStyle(1, SELECT_COLOR);
                for (const [sx, sy] of
                    [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
                    g.moveTo(x + sx * r - sx * arm, y + sy * r);
                    g.lineTo(x + sx * r, y + sy * r);
                    g.lineTo(x + sx * r, y + sy * r - sy * arm);
                }
            }
        }
    }

    private drawLink(graphics: PIXI.Graphics, a: SystemData, b: SystemData,
        color = GREY, thickness = 1) {
        graphics.lineStyle(thickness, color);
        graphics.moveTo(...this.scalePos(a.position));
        graphics.lineTo(...this.scalePos(b.position));
    }

    private computeShortestPaths() {
        // Dijkstra's
        let frontier = new Set<string>([this.currentSystem]);
        const paths = new Map<string, string[]>([[this.currentSystem, []]]);

        while (true) {
            const newFrontier = new Set<string>();
            for (const id of frontier) {
                const system = this.systems.get(id);
                if (!system) {
                    continue;
                }

                const path = paths.get(id);
                if (!path) {
                    throw new Error(`Path to ${id} should exist`);
                }

                for (const link of system.links) {
                    if (paths.has(link)) {
                        continue;
                    }
                    newFrontier.add(link);
                    paths.set(link, [...path, link]);
                }
            }
            if (newFrontier.size === 0) {
                break;
            }
            frontier = newFrontier;
        }
        return paths;
    }
}

/**
 * Client-side persistence for the map's route state, owned by the plugin so
 * pinned waypoints and the single-jump pick survive world rebuilds (system
 * transits). Never simulation state: only the effective route (a plain
 * string[] of adjacent hops) reaches the sim, through the same
 * SetJumpRouteEvent -> setPlayerJumpRoute input-record path a plain route
 * always used.
 */
export interface RouteStateStore {
    state: RouteState;
}

/** Extra per-open context for the starmap (see OpenStarmapResource). */
export interface OpenStarmapOptions {
    /**
     * Destination marks of the mission being viewed in the Mission BBS,
     * shown in green while this map is open.
     */
    viewedMarks?: MissionMapMark[];
    /**
     * Overrides the plugin's active-mission marks (orange) for this open.
     * Landed screens must pass these: the docked entity — and with it the
     * Missions component — is out of the display world, so the plugin's own
     * lookup comes up empty while a menu has the ship.
     */
    missionMarks?: MissionMapMark[];
    /**
     * The player's calendar date for the gray readout, when the caller has
     * it handy (landed screens; the entity is out of the display world
     * while docked, so the plugin can't always read it itself).
     */
    date?: GameDate;
}

// Right-column/properties fonts. Field captions are the light grey the
// original uses — every caption pixel in the reference panel is exactly
// #c0c0c0 (probe_colors on map/borders_off.png at 1144,297), not the
// blue-grey they used to be drawn in; values are white.
const PROP_LABEL_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0xc0c0c0,
    align: 'left', wordWrap: false,
};
const PROP_VALUE_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0xffffff,
    align: 'left', wordWrap: false,
};
const DATE_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0x888888,
    align: 'right', wordWrap: false,
};

// Layout (container-centered like every menu): the nova:8509 dialog frame
// holds the 456x419 map pane at (-290,-248); the properties column sits to
// its right and the Ports/Hazards readouts plus the button row below it,
// matching map_open_over_spaceport.png.
const MAP_POS = { x: -290, y: -248 };
const PROP_X = 177;
/**
 * The properties column's five groups sit at FIXED rows, not stacked one
 * under the other: measured on map/borders_off.png, map_single_jump_route.png
 * and map_zoomed_out_showing_far_away_mission.png, whose captions land on the
 * same screen rows (297 / 360 / 404 / 440 / 535) even though their Goods
 * Traded lists are six entries long, one entry long and six again. Rows are
 * container-relative (the dialog is centred on a 1080-tall screen, and text
 * ink starts ~2px below a PIXI text box).
 */
const PROP_TOP = 297 - 540 - 2;
const PROP_GROUP_Y = [0, 62, 108, 144, 236];
/** Which of those slots a properties group occupies. */
const enum PropSlot {
    System = 0, Government = 1, LegalStatus = 2, Goods = 3, Services = 4,
}
/** A group's first value sits 13px under its caption, the rest 12px apart. */
const PROP_LINE = 12;
const PROP_FIRST_VALUE = 14;
/** Values are indented 5px from their caption. */
const PROP_VALUE_INDENT = 5;
/**
 * The Ports / Navigation Hazards readouts under the map pane. Measured on
 * map/borders_off.png: the two captions' ink starts at x=678 (container -282)
 * on rows 725 and 749, their values at x=713 and x=778, and the grey date
 * shares the hazards row.
 */
const PORTS_LABEL_X = -282;
const PORTS_VALUE_X = -247;
const HAZARDS_VALUE_X = -182;
const PORTS_Y = 184;
const HAZARDS_Y = 208;
const DATE_RIGHT_X = 288;
// Measured against map_single_jump_route.png at 1920x1080: the reference
// row's red button core spans y=773..783 (center 778); at BUTTON_Y=220 ours
// sat at center 771 with the dialog frame edges exactly aligned, so the row
// moves 7px down.
const BUTTON_Y = 227;

export class Starmap extends Menu<string[] /* route list of systems */> {
    private systemGraph?: SystemGraph;
    private allSystems?: SystemData[];
    private graphBitsKey?: string;
    // The original game's mission-mark icons (cicn 15000 orange active /
    // 15001 green BBS-viewed), loaded once in build() and handed to each
    // SystemGraph so the marks render as the real art.
    private missionMarkTextures?: {
        active: PIXI.Texture, viewed: PIXI.Texture,
    };
    private universe: MissionUniverse;
    private findDialog: FindDialog;
    private buttons: {
        borders: Button, clear: Button, find: Button,
        zoomOut: Button, zoomIn: Button, done: Button,
    };
    private bordersShown = false;
    /** Set by the plugin for the current open (BBS-viewed mission marks,
     * a landed caller's date). */
    openOptions: OpenStarmapOptions = {};

    // The properties readouts.
    private propContainer = new PIXI.Container();
    private portsLabel = new PIXI.Text('Ports:', PROP_LABEL_FONT);
    private portsValue = new PIXI.Text('', PROP_VALUE_FONT);
    private hazardsLabel = new PIXI.Text('Navigation Hazards:',
        PROP_LABEL_FONT);
    private hazardsValue = new PIXI.Text('', PROP_VALUE_FONT);
    private dateText = new PIXI.Text('', DATE_FONT);

    constructor(displayAssets: DisplayAssetDataInterface,
        simulationData: SimulationGameDataInterface,
        private systemId: string, controlEvents: Observable<ControlEvent>,
        /** The player's control bits, for NCB system visibility. */
        private getPlayerBits: () => ReadonlySet<number> = () => new Set(),
        /**
         * The player's active-mission map markers (mission_logic
         * missionMapMarks), refreshed each time the map opens. Optional:
         * omit for a marker-free map.
         */
        private getMissionMarks: () => MissionMapMark[] = () => [],
        /** Persistent route state (see RouteStateStore). */
        private routeStore: RouteStateStore = { state: { pinned: [] } },
        /** Whether the player has explored (entered) a system; unexplored
         * systems' properties read "<Unknown>". */
        private isSystemExplored: (systemId: string) => boolean = () => true,
        /** The player's calendar date (in flight). Landed callers pass it
         * through OpenStarmapOptions instead. */
        private getDate: () => GameDate | undefined = () => undefined,
        /** The player's legal records, for the Legal Status line. */
        private getLegalRecords: () => LegalRecordsState | undefined =
            () => undefined) {
        super(displayAssets, simulationData, "nova:8509", controlEvents);
        this.container.name = "StarMap";
        this.universe = MissionUniverse.shared(simulationData);
        this.buttons = {
            borders: new Button(displayAssets, "Show Borders", 100,
                { x: -287, y: BUTTON_Y }),
            clear: new Button(displayAssets, "Clear Route", 88,
                { x: -142, y: BUTTON_Y }),
            find: new Button(displayAssets, "Find", 66,
                { x: -10, y: BUTTON_Y }),
            zoomOut: new Button(displayAssets, "-", 10,
                { x: 110, y: BUTTON_Y }),
            zoomIn: new Button(displayAssets, "+", 10,
                { x: 141, y: BUTTON_Y }),
            done: new Button(displayAssets, "Done", 64,
                { x: 188, y: BUTTON_Y }),
        };
        this.addButtons(this.buttons);

        this.buttons.done.click.subscribe(this.done.bind(this));
        this.buttons.borders.click.subscribe(() => this.toggleBorders());
        this.buttons.clear.click.subscribe(() => {
            this.systemGraph?.clearRoute();
        });
        this.buttons.find.click.subscribe(() => void this.openFind());
        this.buttons.zoomOut.click.subscribe(
            () => this.systemGraph?.zoomBy(1 / ZOOM_STEP ** 2));
        this.buttons.zoomIn.click.subscribe(
            () => this.systemGraph?.zoomBy(ZOOM_STEP ** 2));

        this.findDialog = new FindDialog(controlEvents);

        this.controls = new MenuControls(controlEvents, {
            depart: this.done.bind(this),
            map: this.done.bind(this),
            // Tab cycles through possible single-jump routes.
            nextTarget: () => this.systemGraph?.cycleSingleRoute(1),
            // Space re-centers the view on the current system.
            firePrimary: () => this.systemGraph?.center(),
            // Arrow keys pan the map.
            up: () => this.systemGraph?.pan(0, KEY_PAN_STEP),
            down: () => this.systemGraph?.pan(0, -KEY_PAN_STEP),
            left: () => this.systemGraph?.pan(KEY_PAN_STEP, 0),
            right: () => this.systemGraph?.pan(-KEY_PAN_STEP, 0),
        });
    }

    override async build() {
        await super.build();
        const systemIds = (await this.simulationData.ids).System;
        this.allSystems = await Promise.all(
            systemIds.map(s => this.simulationData.data.System.get(s)));
        // Planet/govt/system indices for the properties panel and borders.
        await this.universe.load();
        // The original's mission-mark icons. Loaded via the same
        // textureFromCicn path the target-corner icons use; the objects/
        // FilesystemData overlay wins over parsed data if it ever provides
        // these ids.
        const [active, viewed] = await Promise.all([
            this.displayAssets.textureFromCicn(MISSION_MARK_ACTIVE_CICN),
            this.displayAssets.textureFromCicn(MISSION_MARK_VIEWED_CICN),
        ]);
        this.missionMarkTextures = { active, viewed };
        this.rebuildGraph(this.getPlayerBits());

        this.propContainer.position.set(0, 0);
        this.container.addChild(this.propContainer);
        this.portsLabel.position.set(PORTS_LABEL_X, PORTS_Y);
        this.portsValue.position.set(PORTS_VALUE_X, PORTS_Y);
        this.hazardsLabel.position.set(PORTS_LABEL_X, HAZARDS_Y);
        this.hazardsValue.position.set(HAZARDS_VALUE_X, HAZARDS_Y);
        this.dateText.anchor.x = 1;
        this.dateText.position.set(DATE_RIGHT_X, HAZARDS_Y);
        this.container.addChild(this.portsLabel, this.portsValue,
            this.hazardsLabel, this.hazardsValue, this.dateText);
        this.container.addChild(this.findDialog.container);
    }

    /** (Re)filters the map against the given control bits. */
    private rebuildGraph(bits: ReadonlySet<number>) {
        if (!this.allSystems) {
            return;
        }
        // The active-mission markers can change independently of the bits
        // (accepting/completing a mission), and the BBS-viewed marks change
        // per open, so they're part of the key.
        const missionMarks =
            this.openOptions.missionMarks ?? this.getMissionMarks();
        const viewedMarks = this.openOptions.viewedMarks ?? [];
        const marksKey = [
            ...missionMarks.map(m => `${m.systemId}:${m.kind}`).sort(),
            '#viewed',
            ...viewedMarks.map(m => m.systemId).sort(),
        ].join('|');
        const key = [...bits].sort((a, b) => a - b).join(',') + '#' + marksKey;
        if (this.systemGraph && key === this.graphBitsKey) {
            return;
        }
        if (this.systemGraph) {
            this.container.removeChild(this.systemGraph.container);
        }
        this.graphBitsKey = key;
        // The regular starmap does NOT show hypergate lanes — the original
        // game only reveals the network on the hypergate transit map
        // (GateMap), which is where the lanes are drawn (via
        // SystemGraphOptions.gateLinks).
        this.systemGraph = new SystemGraph(this.allSystems, this.systemId, {
            playerBits: bits,
            missionMarks,
            viewedMarks,
            missionMarkTextures: this.missionMarkTextures,
            govtColorOf: system => this.govtColorOf(system),
            isSystemInhabited: system => systemIsInhabited(system.planets,
                id => this.universe.getPlanet(id)),
            isSystemExplored: id => this.isSystemExplored(id),
        });
        this.systemGraph.container.position.set(MAP_POS.x, MAP_POS.y);
        // Keep the graph under the buttons/readouts (they were added to the
        // container first), matching the dialog frame's layering.
        this.container.addChildAt(this.systemGraph.container, 1);
        this.systemGraph.setBordersShown(this.bordersShown);
        this.systemGraph.infoSelection.subscribe(
            id => this.showProperties(id));
        this.systemGraph.routeChanged.subscribe(
            () => this.refreshClearButton());
    }

    /** The Show Borders blob color for a system: its govt's color. */
    private govtColorOf(system: SystemData): number | null {
        if (!system.govt) {
            return null;
        }
        const govt = this.universe.getGovt(system.govt);
        if (!govt) {
            return null;
        }
        // A govt with color 0 (black, the field's default) still owns
        // territory; give it the original's deep blue so its space shows.
        const color = govt.color & 0xffffff;
        return color === 0 ? 0x000090 : color;
    }

    private toggleBorders() {
        this.bordersShown = !this.bordersShown;
        this.systemGraph?.setBordersShown(this.bordersShown);
        this.buttons.borders.setLabel(
            this.bordersShown ? 'Hide Borders' : 'Show Borders');
    }

    private refreshClearButton() {
        this.buttons.clear.state =
            this.systemGraph?.hasRoute ? 'normal' : 'grey';
    }

    private async openFind() {
        if (!this.systemGraph) {
            return;
        }
        const name = await this.findDialog.show();
        if (name) {
            this.systemGraph.findByName(name);
        }
    }

    /**
     * Fills the properties panel for a system: the right-hand column
     * (Current/Destination System, Government, Legal Status, Goods Traded,
     * Services) and the Ports / Navigation Hazards readouts. Everything but
     * the title reads "<Unknown>" until the player has explored the system.
     */
    private showProperties(systemId: string) {
        this.propContainer.removeChildren();
        // Each group owns one of the column's five fixed slots, so a short
        // Goods Traded list (or a missing Legal Status, in an ungoverned
        // system) leaves a gap rather than pulling the rest up — which is
        // what the original does.
        const addLine = (slot: PropSlot, label: string, values: string[]) => {
            const top = PROP_TOP + PROP_GROUP_Y[slot];
            const labelText = new PIXI.Text(label, PROP_LABEL_FONT);
            labelText.position.set(PROP_X, top);
            this.propContainer.addChild(labelText);
            values.forEach((value, i) => {
                const valueText = new PIXI.Text(value, PROP_VALUE_FONT);
                valueText.position.set(PROP_X + PROP_VALUE_INDENT,
                    top + PROP_FIRST_VALUE + i * PROP_LINE);
                this.propContainer.addChild(valueText);
            });
        };

        const isCurrent = systemId === this.systemId;
        const title = isCurrent ? 'Current System:' : 'Destination System:';
        const system = this.allSystems?.find(s => s.id === systemId);
        const explored = this.isSystemExplored(systemId);
        if (!system || !explored) {
            addLine(PropSlot.System, title,
                [explored && system ? displayName(system.name) : '<Unknown>']);
            this.portsValue.text = '<Unknown>';
            this.hazardsValue.text = '<Unknown>';
            return;
        }

        addLine(PropSlot.System, title, [displayName(system.name)]);

        const govt = system.govt
            ? this.universe.getGovt(system.govt) : undefined;
        // Strip the "; note" author suffix ("Federation;hates Temmin
        // Shard" -> "Federation") the original never shows.
        addLine(PropSlot.Government, 'Government:',
            [govt ? displayName(govt.name) : 'Independent']);

        if (govt && system.govt) {
            const record = this.getLegalRecords()?.get(system.govt) ?? 0;
            addLine(PropSlot.LegalStatus, 'Legal Status:',
                [legalStatusName(record, govt.crimeTol)]);
        }

        // Ports: the landable, INHABITED stellars (landable.ts isPort — the
        // same predicate that colors the dot). Goods/services aggregate over
        // them. Sol's readout in the original is "Earth, Mars, Europa": its
        // landable-but-uninhabited Wormhole is not a port.
        const planets = system.planets
            .map(id => this.universe.getPlanet(id))
            .filter(<T>(p: T): p is NonNullable<T> => p != null);
        const ports = planets.filter(p => isPort(p.flags));

        const goods = new Set<number>();
        let trading = false, outfitting = false, shipyard = false;
        for (const port of ports) {
            port.tradeTiers.forEach((tier, i) => {
                if (tier !== null) {
                    goods.add(i);
                }
            });
            trading ||= port.flags.hasCommodityExchange;
            outfitting ||= port.flags.hasOutfitter;
            shipyard ||= port.flags.hasShipyard;
        }
        addLine(PropSlot.Goods, 'Goods Traded:', goods.size > 0
            ? [...goods].sort((a, b) => a - b)
                .map(i => STANDARD_CARGO_NAMES[i] ?? `Cargo ${i}`)
            : ['None']);
        const services = [
            ...(trading ? ['Trading'] : []),
            ...(outfitting ? ['Outfitting'] : []),
            ...(shipyard ? ['Shipyard'] : []),
        ];
        addLine(PropSlot.Services, 'Services:',
            services.length > 0 ? services : ['None']);

        this.portsValue.text = ports.length > 0
            ? ports.map(p => displayName(p.name)).join(', ') : 'None';
        this.hazardsValue.text =
            hazardDescription(system.asteroids, system.interference);
    }

    override async show(route: string[]) {
        await this.buildPromise
        // The player's bits may have changed (missions, outfits) since
        // the graph was built; refilter NCB-gated systems.
        this.rebuildGraph(this.getPlayerBits());
        if (!this.systemGraph) {
            throw new Error('Expected system graph to be built')
        }
        // Bring the persisted pins/single up to date with where the player
        // is now, adopting the sim's route if the client state was lost.
        this.routeStore.state = reconcileRouteState(this.routeStore.state,
            this.systemId, this.systemGraph.adjacency, route,
            this.systemGraph.samePlace);
        this.systemGraph.setRouteState(this.routeStore.state);
        this.systemGraph.center();
        this.refreshClearButton();
        this.showProperties(this.systemId);
        const date = this.openOptions.date ?? this.getDate();
        this.dateText.text = date ? formatMapDate(date) : '';
        try {
            return await super.show(route);
        } finally {
            // Viewed-mission marks only last for the open that set them.
            this.openOptions = {};
        }
    }

    override done() {
        if (this.systemGraph) {
            this.routeStore.state = this.systemGraph.getRouteState();
            this.input = this.systemGraph.getEffectiveRoute();
        }
        super.done();
    }
}
