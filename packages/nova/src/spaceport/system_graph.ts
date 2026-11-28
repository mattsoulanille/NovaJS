// The drawn galaxy: the map pane the starmap, the hypergate transit map
// (gate_map.ts) and the title screen's rollback view (rollback_screen.ts)
// all share. Decides WHICH systems exist for the player and what is
// selected; the geometry lives in starmap_viewport.ts, the painters in
// starmap_draw.ts / starmap_marks.ts, the pointer wiring in
// starmap_input.ts and the pure data rules in system_graph_data.ts.
import { NebulaData } from "novadatainterface/nebula_data";
import { SystemData } from "novadatainterface/system_data";
import * as PIXI from 'pixi.js';
import { Subject } from "rxjs";
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DiscoveryLevel, drawnSystems,
} from "../nova_plugin/player/index.js";
import { displayName } from "../nova_plugin/core/index.js";
import { MissionMapMark } from "../nova_plugin/missions/index.js";
import { enhancementEnabled } from "../enhancements.js";
import {
    Adjacency, adjacentSystems, buildAdjacency, canPin, cycleSingle,
    effectiveRoute, expandRoute, Passable, pickOnMiniMap, RouteState,
    SamePlace, settleMiniMapPick,
} from "./route.js";
import {
    drawCurrentSystemCentre, drawGatePickOverlay, drawLinks,
    drawRouteOverlay, GATE_MAP_LANE_COLOR, LANE_COLOR,
    drawSystem, installLabelFont, labelFontReady, makeSystemLabel, MapRefusal,
    systemDotColor,
} from "./starmap_draw.js";
import { drawTerritory, TerritoryOwner, TerritorySite } from "./starmap_borders.js";
import { bindMapPointer } from "./starmap_input.js";
import { buildMissionMarks, MissionMarkTextures } from "./starmap_marks.js";
import {
    boundsWithNebulae, NebulaLayer, visibleNebulae,
} from "./starmap_nebulae.js";
import { PinchLevelStepper } from "./starmap_gestures.js";
import {
    BASE_SCALE, KEY_PAN_STEP, MapViewport, ORIGINAL_KEY_PAN_UNITS,
    originalZoomStep, scalePos, worldBoundsOf, ZOOM_STEP,
} from "./starmap_viewport.js";
import {
    knownLinks, placeKey, reachablePaths, representativeSystems,
    resolveGateLinks, systemVisible,
} from "./system_graph_data.js";

/**
 * The "Smooth map zoom" NovaJS enhancement, read live: on, the maps zoom
 * continuously (x 1.3225 a button, the wheel and a pinch about the
 * pointer), an arrow pans 40 screen px and the pan stays near the galaxy;
 * off, the original's controls (reference "Star-map nebulae (nëbu), wave
 * 53", items 1 and 4): seven fixed zoom levels, one a button, key or
 * wheel detent, about the view's centre; an arrow pans 10 map units at
 * every zoom; the pan has no limit. Both open at the original's 177.7 %.
 */
function smoothMapControls(): boolean {
    return enhancementEnabled('enhSmoothMapZoom');
}

export interface SystemGraphOptions {
    /**
     * Hypergate lanes to overlay, each a DIRECTED pair of system global ids
     * (from, to) drawn as an arrow at `to`. The REGULAR starmap does not
     * show hypergate lanes (matching the original game); only the hypergate
     * transit map (GateMap) passes these.
     */
    gateLinks?: [string, string][];
    /**
     * Destination-picker mode: for each offered system, the lanes (as in
     * {@link gateLinks}) drawn white while it is picked. A picked system
     * with no entry whitens the lane from the current system to it.
     */
    gateRoutes?: ReadonlyMap<string, [string, string][]>;
    /**
     * Destination-picker mode: clicking is restricted to these systems, and a
     * click selects (highlights) the system instead of plotting a route. Used
     * by the hypergate map to pick one of the gate's linked neighbors.
     */
    selectable?: Set<string>;
    /**
     * Destination-picker mode: the order Tab ({@link
     * SystemGraph.cycleSingleRoute}) picks the selectable systems in. The
     * hypergate map passes its gate's HyperLink slot order. Omitted, Tab
     * picks nothing in picker mode.
     */
    selectableOrder?: readonly string[];
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
     * special-ship-system arrows.
     *
     * A mark FORCES ITS SYSTEM ONTO THE MAP. An active mission tells you
     * where to go even when the destination is nowhere near anything you
     * have discovered: the reference capture
     * (map_zoomed_out_showing_far_away_mission.png) has one lone #424242
     * dot far from the known galaxy, unlabeled, joined to no lanes at all,
     * with the orange arrow beside it. The dot is the mission's, so it goes
     * away with the mission — abort or finish it and, unless something else
     * points there, the system stops being drawn again. Marks never affect
     * routing, and a mark on a system the player HAS discovered changes
     * nothing about how that system draws.
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
    missionMarkTextures?: MissionMarkTextures;
    /**
     * Who a system's territory belongs to for Show Borders (its gövt's
     * color and whether that gövt is "minor"), or null when it claims none
     * (no government, or one flagged to stay off the boundaries). Injected
     * so the graph itself stays free of async data loads; see
     * starmap_borders.ts for how the owners become shapes.
     */
    territoryOf?: (system: SystemData) => TerritoryOwner | null;
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
     * Whether an inhabited system's every port would refuse the player's
     * landing, and at which record sign, which turns its dot ORANGE or RED
     * (starmap_draw.ts systemDotColor, landable.ts systemRefusesLanding);
     * undefined when the player may land somewhere there. Injected for the
     * same reason as {@link isSystemInhabited}; only the player's own maps
     * — the star map, the `h` minimap and the hypergate map, all through
     * starmap.ts mapDotRule — pass it (it needs the player's records), so
     * the rollback screen defaults to "never".
     */
    systemRefusal?: (system: SystemData) => MapRefusal | undefined;
    /**
     * Whether a system holds at least one INHABITED stellar, landable or
     * not, deciding whether an explored system radiates territory under
     * Show Borders (see drawBorders). Not the same question as {@link
     * isSystemInhabited}: an inhabited stellar nobody can land on draws a
     * grey dot but still claims territory (reference_experiments.md "M5
     * leftover"). Callers pass `system => systemHasInhabitedStellar(
     * system.planets, getPlanet)`; defaults to "none", like the dot.
     */
    hasInhabitedStellar?: (system: SystemData) => boolean;
    /**
     * How much the player knows about a system (discovery.ts): 0 unknown,
     * 1 entered, 2 landed within. Drives THREE things — whether the system
     * is drawn at all, whether its dot is dim, and whether it is labeled.
     *
     * Defaults to "landed", which is what the maps with no discovery record
     * of their own (the rollback screen's replay map, the hypergate transit
     * map) want: everything drawn, nothing dim.
     */
    discoveryOf?: (systemId: string) => DiscoveryLevel;
    /**
     * The in-flight hyperspace minimap (`h`, mini_map.ts) instead of the
     * full map. A glance, not a planner (reference_experiments M1-M3): a
     * click on a neighbour of the current system picks it as the single
     * next jump — shift and ctrl change nothing (no multi-jump editing),
     * and clicking the pick again keeps it — and a drag that starts on the
     * current system clears the route. Nothing else responds: clicking a
     * non-neighbour inspects nothing (there is no properties column), and
     * the view cannot be dragged or zoomed. The current system is marked
     * by its cyan centre alone, as in mini_map.png, without the full map's
     * dashed ring.
     */
    miniMap?: boolean;
    /**
     * The colour of the ordinary hyperspace lanes. Defaults to the star
     * map's #4a4a4a (starmap_draw.ts LANE_COLOR), or in destination-picker
     * mode to the original gate map's nearly black #080808
     * (GATE_MAP_LANE_COLOR). The gate map passes its own: grey unless the
     * player turned the `enhGateMapLanes` enhancement off.
     */
    laneColor?: number;
    /**
     * The nebulae (nëbu) to draw under the map, with the picture loader
     * they are drawn through. Only the full star map passes them: the `h`
     * minimap draws none (measured, reference wave 53, at Holpa Station
     * inside Holpa Nebula); the hypergate map is not measured and passes
     * none either. The graph shows the ones the player sees
     * (starmap_nebulae.ts nebulaVisible) against {@link playerBits} and
     * {@link discoveryOf}.
     */
    nebulae?: readonly NebulaData[];
    nebulaTexture?: (pictId: string) => PIXI.Texture;
}

export class SystemGraph {
    readonly container = new PIXI.Container();
    /** Emits the plainly-clicked system (route mode), or the picked one
     * (destination-picker mode), for the properties panel. */
    readonly infoSelection = new Subject<string>();
    /** Emits whenever the pinned/single route state changes (route mode). */
    readonly routeChanged = new Subject<void>();
    /** Emits whenever the view's zoom changes (the star map's - / +
     * buttons grey out at the original's last levels). */
    readonly zoomChanged = new Subject<void>();
    /** A pinch's progress towards the next original zoom level. */
    private readonly pinchSteps = new PinchLevelStepper();

    // Links and the highlighted route live on separate graphics so that
    // selecting a route only redraws the route, not the whole galaxy.
    private readonly linkGraphics: PIXI.Graphics;
    private readonly routeGraphics: PIXI.Graphics;
    /** The current system's #00adef centre in route mode, ABOVE the dots
     * (starmap_draw.ts drawCurrentSystemCentre). */
    private readonly centreGraphics: PIXI.Graphics;
    /** The hypergate arrows and picker marks, over the dots
     * (starmap_draw.ts drawGatePickOverlay). */
    private readonly gateGraphics: PIXI.Graphics;
    private readonly gateRoutes: ReadonlyMap<string, [string, string][]>;
    private readonly borderGraphics: PIXI.Graphics;
    private readonly links: [SystemData, SystemData][];
    private readonly systems: Map<string, SystemData>;
    /** Adjacency over the visible systems, for route planning. */
    private readonly adj: Adjacency;
    /** The pan/zoom view of the galaxy (starmap_viewport.ts). */
    private readonly viewport: MapViewport;
    // Route mode state (see route.ts): pinned multi-jump waypoints, the
    // single-jump destination, and the system whose properties are shown.
    private pinned: string[] = [];
    private single?: string;
    /** RouteState.singleFirst: the single jump is a minimap pick that
     * overrides the multi-jump route's first hop. */
    private singleFirst = false;
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

    // Hypergate links between systems (each a pair of system global ids).
    // Drawn in a distinct style from the normal grey hyperspace links.
    private readonly gateLinks: [SystemData, SystemData][];
    // Destination-picker mode (see SystemGraphOptions.selectable).
    private readonly selectable?: Set<string>;
    // Tab's order in destination-picker mode
    // (SystemGraphOptions.selectableOrder).
    private readonly selectableOrder: readonly string[];
    // Active-mission destination / ship-syst markers (decorative overlay).
    private readonly missionMarks: MissionMapMark[];
    private readonly viewedMarks: MissionMapMark[];
    /** The picked system in destination-picker mode, if any. */
    selectedSystem?: string;
    // The two questions drawSystem asks about each dot. Injected; see
    // SystemGraphOptions.
    private readonly isSystemInhabited: (system: SystemData) => boolean;
    private readonly systemRefusal:
        (system: SystemData) => MapRefusal | undefined;
    private readonly hasInhabitedStellar: (system: SystemData) => boolean;
    private readonly discoveryOf: (systemId: string) => DiscoveryLevel;
    /**
     * The systems this map draws at all: everything the player has entered,
     * their immediate neighbours (the dim unlabeled ring), every active
     * mission's destination however far away it is, and the system the
     * player is standing in. See discovery.ts drawnSystems for the evidence.
     */
    private readonly drawn: Set<string>;
    private readonly miniMap: boolean;
    /** The colour the ordinary hyperspace lanes are drawn in
     * ({@link SystemGraphOptions.laneColor}). */
    readonly laneColor: number;
    /** The drawn nebulae, when the caller passed any
     * ({@link SystemGraphOptions.nebulae}). */
    readonly nebulae?: NebulaLayer;

    constructor(systems: SystemData[], private currentSystem: string,
        options: SystemGraphOptions = {}) {
        const gateLinks = options.gateLinks ?? [];
        const playerBits = options.playerBits ?? new Set<number>();
        this.selectable = options.selectable;
        this.selectableOrder = (options.selectableOrder ?? [])
            .filter(id => options.selectable?.has(id));
        this.gateRoutes = options.gateRoutes ?? new Map();
        this.missionMarks = options.missionMarks ?? [];
        this.viewedMarks = options.viewedMarks ?? [];
        this.isSystemInhabited = options.isSystemInhabited ?? (() => false);
        this.systemRefusal = options.systemRefusal ?? (() => undefined);
        this.hasInhabitedStellar = options.hasInhabitedStellar
            ?? (() => false);
        this.discoveryOf = options.discoveryOf ?? (() => DISCOVERY_LANDED);
        this.miniMap = options.miniMap ?? false;
        // The original's gate map draws the hyperspace lanes nearly black,
        // its star map grey (starmap_draw.ts GATE_MAP_LANE_COLOR /
        // LANE_COLOR); the gate map passes its own (laneColor).
        this.laneColor = options.laneColor
            ?? (this.selectable ? GATE_MAP_LANE_COLOR : LANE_COLOR);
        const size = options.size ?? { x: 456, y: 419 };
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
        this.routes = reachablePaths(this.systems, currentSystem);
        // What the map is allowed to show. The adjacency stays the WHOLE
        // visible graph (this.adj / this.routes); what the router may fly
        // THROUGH is the separate {@link passable} rule — exactly this
        // drawn set (route.ts, DRAWN SYSTEMS ONLY). A mission's faraway
        // destination is drawn (a bare dot with no links) but is only
        // plottable once the drawn map reaches up to it: within two jumps
        // of explored space, through the dim ring.
        this.drawn = drawnSystems(
            visibleSystems.map(s => s.id).filter(
                id => this.discoveryOf(id) >= DISCOVERY_ENTERED),
            this.adj,
            [
                ...this.missionMarks.map(m => m.systemId),
                ...this.viewedMarks.map(m => m.systemId),
                // Somewhere this map exists to let the player PICK is
                // always drawn: a hypergate's offered destinations, an
                // unexplored one as the dim unlabeled ring (reference
                // "Gate map, wave 27": N3, no hyperspace neighbour of
                // anything explored, has its #424242 ring under the
                // arrowhead). Under transitivity every lane's end is
                // offered too, so this covers the lanes as well.
                ...(this.selectable ?? []),
            ],
            currentSystem);
        this.clickTargets = this.pickRepresentativeSystems(
            visibleSystems.filter(s => this.drawn.has(s.id)));

        this.linkGraphics = new PIXI.Graphics();
        this.routeGraphics = new PIXI.Graphics();
        this.centreGraphics = new PIXI.Graphics();
        this.gateGraphics = new PIXI.Graphics();
        this.borderGraphics = new PIXI.Graphics();
        this.borderGraphics.visible = false;

        const shownNebulae = options.nebulae && options.nebulaTexture
            ? visibleNebulae(options.nebulae, systems, currentSystem,
                playerBits, this.discoveryOf)
            : [];
        // Bounding box of all systems in laid-out (BASE_SCALE) coordinates,
        // and of the nebulae the player sees: the pan reaches all of each.
        this.viewport = new MapViewport(this.container, size,
            boundsWithNebulae(
                worldBoundsOf(visibleSystems.map(s => s.position)),
                shownNebulae),
            // The original's pan is unbounded (wave 53).
            smoothMapControls);
        const mapContainer = this.viewport.mapContainer;
        // Borders sit under everything else; the route overlays the links.
        mapContainer.addChild(this.borderGraphics);
        if (options.nebulaTexture && options.nebulae) {
            this.nebulae = new NebulaLayer(shownNebulae,
                options.nebulaTexture);
            // Over the borders, MAX-blended with them, and under the rest
            // (starmap_nebulae.ts NebulaLayer).
            mapContainer.addChild(this.nebulae.container);
        }
        mapContainer.addChild(this.linkGraphics);
        mapContainer.addChild(this.routeGraphics);

        bindMapPointer(this.container, size, {
            // The minimap is a fixed glance around the current system.
            fixed: this.miniMap,
            pan: (dx, dy) => {
                if (!this.miniMap) {
                    this.pan(dx, dy);
                }
            },
            zoomAt: (factor, x, y, notched) => {
                if (!this.miniMap) {
                    this.wheelZoom(factor, x, y, notched);
                }
            },
            tap: (x, y, shiftKey) => this.onTap(x, y, shiftKey),
            dragStart: (x, y) => {
                const system = this.systemAt(x, y);
                if (system) {
                    this.onDragFromSystem(system.id);
                }
            },
        });

        this.links = knownLinks(this.systems, this.discoveryOf);
        this.gateLinks = resolveGateLinks(this.systems, gateLinks);

        // All circles are baked into a single Graphics and all labels share
        // one bitmap font texture, so drawing the whole galaxy takes a couple
        // of draw calls instead of ~1300 display objects with distinct
        // textures. Pan and zoom are transforms on mapContainer, so nothing
        // here is ever redrawn per frame.
        installLabelFont(this.clickTargets.map(t => t.system));
        // Labels render only when the bitmap font is available (i.e. not in a
        // headless test context, where installLabelFont is a no-op).
        const fontReady = labelFontReady();
        const circleGraphics = new PIXI.Graphics();
        const labelContainer = new PIXI.Container();
        for (const { system, x, y } of this.clickTargets) {
            const discovered = this.discoveryOf(system.id) >= DISCOVERY_ENTERED;
            drawSystem(circleGraphics, x, y, this.dotColorOf(system));
            // The original labels only the systems the player has entered:
            // in map_zoomed_out_showing_far_away_mission.png every dim
            // #424242 dot is nameless, and every named one is blue or
            // #c6c6c6. A name is knowledge, like the dot's color.
            if (fontReady && discovered) {
                labelContainer.addChild(makeSystemLabel(system, x, y));
            }
        }
        mapContainer.addChild(circleGraphics);
        // Above the dots, or their black interiors hide it.
        mapContainer.addChild(this.centreGraphics);
        mapContainer.addChild(this.gateGraphics);
        mapContainer.addChild(labelContainer);
        const marks = buildMissionMarks(this.systems, this.missionMarks,
            this.viewedMarks, options.missionMarkTextures);
        if (marks) {
            mapContainer.addChild(marks);
        }

        if (options.territoryOf) {
            this.drawBorders(options.territoryOf);
        }
        drawLinks(this.linkGraphics, this.links, this.laneColor);
        if (this.selectable) {
            this.drawSelection();
        } else {
            this.drawRoute();
            if (this.gateLinks.length > 0) {
                drawGatePickOverlay(this.gateGraphics,
                    { arrows: this.gateLinks, route: [] });
            }
        }
        this.viewport.applyZoom();
        this.nebulae?.update(BASE_SCALE * this.viewport.zoom);
    }

    /**
     * Frees the graph: its display objects (the dot layer alone is one
     * Graphics of two circles per drawn system, ~16,000 vertices for a
     * mid-game galaxy, plus the lane / route / border layers and the
     * labels) and its subscribers. A graph that is merely removed from its
     * parent keeps all of that alive for as long as anything still holds
     * the graph, so every owner that REPLACES its graph (the star map's
     * re-filter on open, a gate map per landing, the minimap per `h`, the
     * rollback screen per checkpoint) destroys the old one. Textures are
     * the asset cache's (nebula PICTs, mission marks, the label font) and
     * are left alone.
     */
    destroy() {
        this.infoSelection.complete();
        this.routeChanged.complete();
        this.container.parent?.removeChild(this.container);
        this.container.destroy({ children: true });
    }

    /** The map spot each system is drawn on and clicked at: see
     * {@link representativeSystems}. */
    private pickRepresentativeSystems(systems: SystemData[]) {
        return representativeSystems(systems, this.currentSystem,
            id => this.routes.has(id)).map(system => {
                const [x, y] = scalePos(system.position);
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

    /**
     * The colour of a system's dot (starmap_draw.ts systemDotColor), from
     * the injected rule (SystemGraphOptions.isSystemInhabited /
     * systemRefusal) and the player's discovery: what this graph draws,
     * and what specs and headless driving read back.
     */
    dotColorOf(system: SystemData | string): number {
        const data = typeof system === 'string'
            ? this.systems.get(system) : system;
        if (!data) {
            throw new Error(`System ${system} is not on this map`);
        }
        const explored = this.discoveryOf(data.id) >= DISCOVERY_ENTERED;
        return systemDotColor(explored, this.isSystemInhabited(data),
            explored ? this.systemRefusal(data) : undefined);
    }

    /** Whether `systemId` is drawn on this map (visible under its bits). */
    hasSystem(systemId: string): boolean {
        return this.systems.has(systemId);
    }

    /** Centers any system in the viewport at the current zoom. */
    centerOn(systemId: string) {
        const system = this.systems.get(systemId);
        if (system) {
            const [x, y] = scalePos(system.position);
            this.viewport.centerOn(x, y);
        }
    }

    // --- Route mode (the regular starmap) ---

    /** Loads route state (pinned waypoints + single-jump destination). */
    setRouteState(state: RouteState) {
        this.pinned = [...state.pinned];
        this.single = state.single;
        this.singleFirst = state.singleFirst === true;
        this.drawRoute();
    }

    getRouteState(): RouteState {
        return {
            pinned: [...this.pinned], single: this.single,
            ...(this.singleFirst ? { singleFirst: true } : {}),
        };
    }

    /**
     * The full map's Done (route.ts settleMiniMapPick): a minimap pick
     * that overrode the multi-jump route is dropped, so the route's first
     * hop is the next jump again.
     */
    settleMiniMapPick() {
        this.setRouteState(settleMiniMapPick(this.adj, this.currentSystem,
            this.getRouteState(), this.samePlace, this.passable));
    }

    /** The route hyperspace jumps follow: multi-jump takes precedence, but
     * for a minimap pick (route.ts effectiveRoute). */
    getEffectiveRoute(): string[] {
        return effectiveRoute(this.adj, this.currentSystem,
            this.getRouteState(), this.samePlace, this.passable);
    }

    /**
     * Whether the router may fly THROUGH a system (route.ts Passable): the
     * map draws it — explored, a dim unexplored neighbour, a mission's
     * destination, or the system the ship is in. So D-U-D and D-U-U-D
     * chains route, as in the original (reference_experiments M4); a
     * system the map does not draw is never a hop.
     */
    readonly passable: Passable = id =>
        id === this.currentSystem || this.drawn.has(id);

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
        this.singleFirst = false;
        this.routeChanged.next();
        this.drawRoute();
    }

    /** Tab: cycles the single-jump route through the current system's
     * neighbours in link-slot order, wrapping (route.ts cycleSingle). In
     * destination-picker mode it picks the next offered system instead, in
     * {@link SystemGraphOptions.selectableOrder}, by the same rule (from
     * the first, wrapping, no empty step), exactly as a click on it would. */
    cycleSingleRoute(direction = 1) {
        if (this.selectable) {
            const next = cycleSingle(this.selectableOrder,
                this.selectedSystem, direction);
            if (next !== undefined) {
                this.onClickSystem(next, false);
            }
            return;
        }
        const neighbours = adjacentSystems(this.adj, this.currentSystem);
        this.single = cycleSingle(neighbours, this.single, direction);
        this.singleFirst = false;
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
     *
     * Searches only systems the player has ENTERED. The map draws a dim
     * ring of neighbours and any active mission's destination without
     * naming them (they have no label), so a name is not something the
     * pilot could have to type — Find would otherwise answer questions the
     * map is deliberately not answering.
     */
    findByName(name: string): string | undefined {
        const wanted = name.trim().toLowerCase();
        if (!wanted) {
            return undefined;
        }
        let prefixMatch: SystemData | undefined;
        let prefixMatches = 0;
        for (const { system } of this.clickTargets) {
            if (this.discoveryOf(system.id) < DISCOVERY_ENTERED) {
                continue;
            }
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

    /** Pans the map by a screen-space delta (a drag, a trackpad scroll). */
    pan(dx: number, dy: number) {
        this.viewport.pan(dx, dy);
    }

    /**
     * One arrow-key press: pans the view by one step in direction (dx,
     * dy) (each -1, 0 or 1; +1 moves the CONTENT right / down, i.e. looks
     * left / up). With the "Smooth map zoom" enhancement on, a step is
     * {@link KEY_PAN_STEP} screen px; off, the original's 10 map units at
     * every zoom (reference "Star-map nebulae (nëbu), wave 53", item 1).
     */
    panStep(dx: number, dy: number) {
        const step = smoothMapControls() ? KEY_PAN_STEP
            : ORIGINAL_KEY_PAN_UNITS * BASE_SCALE * this.viewport.zoom;
        this.viewport.pan(dx * step, dy * step);
    }

    /**
     * Zooms by `factor`, keeping the point at (centerX, centerY) in the
     * viewport fixed. If no center is given, zooms around the viewport center.
     * Continuous whatever the enhancement says: the maps' opening scales
     * go through here.
     */
    zoomBy(factor: number, centerX?: number, centerY?: number) {
        this.viewport.zoomBy(factor, centerX, centerY);
        this.zoomed();
    }

    /**
     * One zoom step of the - / + buttons and the `-` / `=` keys (+1 in, -1
     * out). With the "Smooth map zoom" enhancement on, x 1.3225 about the
     * view's centre; off, the original's next fixed level (one of seven,
     * {@link ORIGINAL_ZOOM_LEVELS}), keeping the view's centre, and nothing
     * past the last one (wave 53, item 1).
     */
    zoomStep(direction: 1 | -1) {
        if (smoothMapControls()) {
            this.zoomBy(direction > 0 ? ZOOM_STEP ** 2 : 1 / ZOOM_STEP ** 2);
            return;
        }
        const level = originalZoomStep(this.viewport.zoom, direction);
        if (level !== undefined) {
            this.viewport.zoomTo(level);
            this.zoomed();
        }
    }

    /** Whether {@link zoomStep} in `direction` would change anything: false
     * at the original's last level that way (the original greys that
     * button out). Always true with smooth zoom. */
    canZoomStep(direction: 1 | -1): boolean {
        return smoothMapControls()
            || originalZoomStep(this.viewport.zoom, direction) !== undefined;
    }

    /**
     * The wheel or a pinch over the map. Smooth zoom: by `factor` about the
     * pointer. The original's stepped zoom: one level a wheel detent, and a
     * level for each x 4/3 a pinch gathers, about the view's centre (the
     * original's zooms keep the centre).
     */
    private wheelZoom(factor: number, x: number, y: number,
        notched: boolean) {
        if (smoothMapControls()) {
            this.zoomBy(factor, x, y);
            return;
        }
        const steps = notched ? Math.sign(Math.log(factor))
            : this.pinchSteps.steps(factor);
        for (let i = 0; i < Math.abs(steps); i++) {
            this.zoomStep(steps > 0 ? 1 : -1);
        }
    }

    private zoomed() {
        // A nebula's picture is chosen per map scale.
        this.nebulae?.update(BASE_SCALE * this.viewport.zoom);
        this.zoomChanged.next();
    }

    /** The view's zoom over the laid-out map (BASE_SCALE px per unit). */
    get zoom(): number {
        return this.viewport.zoom;
    }

    private onTap(viewX: number, viewY: number, shiftKey: boolean) {
        const system = this.systemAt(viewX, viewY);
        if (system) {
            this.onClickSystem(system.id, shiftKey);
        }
    }

    /**
     * Finds the system nearest to a point in viewport coordinates, or
     * undefined if none is within clicking distance.
     */
    private systemAt(viewX: number, viewY: number): SystemData | undefined {
        const i = this.viewport.targetAt(this.clickTargets, viewX, viewY);
        return i < 0 ? undefined : this.clickTargets[i].system;
    }

    private selectForInfo(system: string) {
        this.infoSelected = system;
        this.infoSelection.next(system);
        this.drawRoute();
    }

    /**
     * Acts as if the player clicked `systemId` on the map (with or without
     * shift held): the same rules as a pointer tap that resolved to it.
     * For headless driving and specs; ignored for a system not on this
     * map.
     */
    clickSystem(systemId: string, shiftKey = false) {
        if (this.systems.has(systemId)) {
            this.onClickSystem(systemId, shiftKey);
        }
    }

    /**
     * Acts as if the player began dragging on `systemId`: the same rule as
     * a pointer drag that started on it. For headless driving and specs;
     * ignored for a system not on this map.
     */
    dragFromSystem(systemId: string) {
        if (this.systems.has(systemId)) {
            this.onDragFromSystem(systemId);
        }
    }

    private onDragFromSystem(system: string) {
        // On the minimap, a drag that starts on the current system drops
        // the destination ("No Destination" in the original); the full map
        // pans instead.
        if (this.miniMap && this.samePlace(system, this.currentSystem)
            && this.hasRoute) {
            this.clearRoute();
        }
    }

    private onClickSystem(system: string, shiftKey: boolean) {
        if (this.miniMap) {
            // The minimap only ever picks the single next jump (see
            // SystemGraphOptions.miniMap), whatever modifier is held.
            // Over a multi-jump route the pick is the next jump, until the
            // full map's Done (route.ts pickOnMiniMap, wave 41).
            if (system !== this.single
                && adjacentSystems(this.adj, this.currentSystem)
                    .includes(system)) {
                this.setRouteState(pickOnMiniMap(this.adj,
                    this.currentSystem, this.getRouteState(), system,
                    this.samePlace, this.passable));
                this.routeChanged.next();
            }
            return;
        }
        if (this.selectable) {
            // Destination-picker mode: only the offered systems respond, and
            // clicking one selects it. Clicking it AGAIN keeps it selected
            // (measured, reference "Gate map, wave 27": two more clicks and
            // a double-click on N2 left it picked); Done with no pick is
            // the only way out without a transit.
            if (!this.selectable.has(system)) {
                return;
            }
            this.selectedSystem = system;
            this.drawSelection();
            this.infoSelection.next(system);
            return;
        }
        if (shiftKey) {
            // Shift-click appends the system to the multi-jump route as a
            // pinned waypoint (or unpins it). Gaps between pins auto-fill
            // with the shortest path when the route is expanded — the only
            // auto-routing there is (map/notes.txt). A NEW pin is only
            // taken when the route can reach it through systems the map
            // draws, explored or not (route.ts canPin) — and, with the
            // "Map auto-routing" enhancement off, only one jump past the
            // route's end, as in the original; otherwise the click just
            // inspects the system, like a plain click on a non-neighbour.
            // Unpinning is always allowed.
            if (this.pinned.includes(system)) {
                this.pinned = this.pinned.filter(p => p !== system);
                this.routeChanged.next();
            } else if (system !== this.currentSystem
                && canPin(this.adj, this.currentSystem, this.pinned, system,
                    this.samePlace, this.passable,
                    enhancementEnabled('enhMapAutoRoute'))) {
                this.pinned = [...this.pinned, system];
                this.routeChanged.next();
            }
        } else if (adjacentSystems(this.adj, this.currentSystem)
            .includes(system)) {
            // A plain click on an adjacent system sets (or toggles off) the
            // single-jump route. Clicking anything else only inspects it.
            this.single = this.single === system ? undefined : system;
            this.singleFirst = false;
            this.routeChanged.next();
        }
        this.selectForInfo(system);
    }

    /** Draws the destination-picker overlay (starmap_draw.ts
     * drawGatePickOverlay): the gate's arrows, the pick's lanes in white,
     * the current system's centre and the selection brackets. */
    private drawSelection() {
        this.routeGraphics.clear();
        if (!this.selectable) {
            this.gateGraphics.clear();
            return;
        }
        const picked = this.selectedSystem !== undefined
            && this.selectable.has(this.selectedSystem)
            ? this.selectedSystem : undefined;
        const route = picked === undefined ? []
            : resolveGateLinks(this.systems, this.gateRoutes.get(picked)
                ?? [[this.currentSystem, picked]]);
        drawGatePickOverlay(this.gateGraphics, {
            arrows: this.gateLinks, route,
            current: this.systems.get(this.currentSystem),
            picked: picked === undefined ? undefined
                : this.systems.get(picked),
        });
    }

    /**
     * Draws the government border overlay (Show Borders): the territory
     * of every explored, governed system with an inhabited stellar
     * (starmap_borders.ts).
     * Baked once
     * into its own layer and simply hidden until toggled on.
     */
    private drawBorders(
        territoryOf: (system: SystemData) => TerritoryOwner | null) {
        const sites: TerritorySite[] = [];
        for (const { system, x, y } of this.clickTargets) {
            // Who owns a system is something you learn by going there: the
            // dim ring around the known galaxy contributes no territory
            // (govt_borders.png — the unexplored Federation system HJG-0637
            // sits in a dark channel between two blobs).
            if (this.discoveryOf(system.id) < DISCOVERY_ENTERED) {
                continue;
            }
            // Nor does an explored system with nobody in it: territory is
            // where a government's people are (starmap_borders.ts — the
            // uninhabited HJG-1034 and Procyon claim none in the capture).
            // People, not a port: an inhabited stellar that cannot be
            // landed on still radiates (reference_experiments.md "M5
            // leftover"), though its dot is grey.
            if (!this.hasInhabitedStellar(system)) {
                continue;
            }
            const owner = territoryOf(system);
            if (owner !== null) {
                sites.push({ x, y, ...owner });
            }
        }
        drawTerritory(this.borderGraphics, sites);
    }

    /** Resolves the systems `ids` names that are on this map, in order. */
    private onMap(ids: readonly string[]): SystemData[] {
        const systems: SystemData[] = [];
        for (const id of ids) {
            const system = this.systems.get(id);
            if (system) {
                systems.push(system);
            }
        }
        return systems;
    }

    /**
     * Draws the route overlay (starmap_draw.ts drawRouteOverlay): the
     * single- and multi-jump routes, pinned waypoints, the current system's
     * ring and the properties-selection brackets, resolved to the systems
     * on this map.
     */
    private drawRoute() {
        if (this.selectable) {
            return;
        }
        const multi = expandRoute(this.adj, this.currentSystem, this.pinned,
            this.samePlace, this.passable);
        drawRouteOverlay(this.routeGraphics, {
            miniMap: this.miniMap,
            // The minimap pales the route's first hop while a pick of its
            // own is the next jump (wave 41).
            paleFirstHop: this.miniMap && this.singleFirst
                && this.single !== undefined,
            current: this.systems.get(this.currentSystem),
            single: this.single === undefined
                ? undefined : this.systems.get(this.single),
            multi: this.onMap(multi),
            pinned: this.onMap(this.pinned),
            info: this.infoSelected !== undefined
                && this.infoSelected !== this.currentSystem
                ? this.systems.get(this.infoSelected) : undefined,
        });
        this.centreGraphics.clear();
        const current = this.systems.get(this.currentSystem);
        if (current) {
            drawCurrentSystemCentre(this.centreGraphics, current);
        }
    }
}
