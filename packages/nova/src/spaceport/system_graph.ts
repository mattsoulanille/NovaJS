// The drawn galaxy: the map pane the starmap, the hypergate transit map
// (gate_map.ts) and the title screen's rollback view (rollback_screen.ts)
// all share. Decides WHICH systems exist for the player and what is
// selected; the geometry lives in starmap_viewport.ts, the painters in
// starmap_draw.ts / starmap_marks.ts, the pointer wiring in
// starmap_input.ts and the pure data rules in system_graph_data.ts.
import { SystemData } from "novadatainterface/system_data";
import * as PIXI from 'pixi.js';
import { Subject } from "rxjs";
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DiscoveryLevel, drawnSystems,
} from "../nova_plugin/player/index.js";
import { displayName } from "../nova_plugin/core/index.js";
import { MissionMapMark } from "../nova_plugin/missions/index.js";
import {
    Adjacency, adjacentSystems, buildAdjacency, cycleSingle, effectiveRoute,
    expandRoute, RouteState, SamePlace,
} from "./route.js";
import {
    drawBorderBlob, drawLinks, drawRouteOverlay, drawSelectionOverlay,
    drawSystem, installLabelFont, labelFontReady, makeSystemLabel,
} from "./starmap_draw.js";
import { bindMapPointer } from "./starmap_input.js";
import { buildMissionMarks, MissionMarkTextures } from "./starmap_marks.js";
import { MapViewport, scalePos, worldBoundsOf } from "./starmap_viewport.js";
import {
    knownLinks, placeKey, reachablePaths, representativeSystems,
    resolveGateLinks, systemVisible,
} from "./system_graph_data.js";

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
     * How much the player knows about a system (discovery.ts): 0 unknown,
     * 1 entered, 2 landed within. Drives THREE things — whether the system
     * is drawn at all, whether its dot is dim, and whether it is labeled.
     *
     * Defaults to "landed", which is what the maps with no discovery record
     * of their own (the rollback screen's replay map, the hypergate transit
     * map) want: everything drawn, nothing dim.
     */
    discoveryOf?: (systemId: string) => DiscoveryLevel;
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
    /** The pan/zoom view of the galaxy (starmap_viewport.ts). */
    private readonly viewport: MapViewport;
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

    // Hypergate links between systems (each a pair of system global ids).
    // Drawn in a distinct style from the normal grey hyperspace links.
    private readonly gateLinks: [SystemData, SystemData][];
    // Destination-picker mode (see SystemGraphOptions.selectable).
    private readonly selectable?: Set<string>;
    // Active-mission destination / ship-syst markers (decorative overlay).
    private readonly missionMarks: MissionMapMark[];
    private readonly viewedMarks: MissionMapMark[];
    /** The picked system in destination-picker mode, if any. */
    selectedSystem?: string;
    // The two questions drawSystem asks about each dot. Injected; see
    // SystemGraphOptions.
    private readonly isSystemInhabited: (system: SystemData) => boolean;
    private readonly discoveryOf: (systemId: string) => DiscoveryLevel;
    /**
     * The systems this map draws at all: everything the player has entered,
     * their immediate neighbours (the dim unlabeled ring), every active
     * mission's destination however far away it is, and the system the
     * player is standing in. See discovery.ts drawnSystems for the evidence.
     */
    private readonly drawn: Set<string>;

    constructor(systems: SystemData[], private currentSystem: string,
        options: SystemGraphOptions = {}) {
        const gateLinks = options.gateLinks ?? [];
        const playerBits = options.playerBits ?? new Set<number>();
        this.selectable = options.selectable;
        this.missionMarks = options.missionMarks ?? [];
        this.viewedMarks = options.viewedMarks ?? [];
        this.isSystemInhabited = options.isSystemInhabited ?? (() => false);
        this.discoveryOf = options.discoveryOf ?? (() => DISCOVERY_LANDED);
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
        // What the map is allowed to show. Route planning deliberately
        // still runs over the WHOLE visible graph (this.adj / this.routes):
        // the drawing rules below are a display filter on the player's
        // knowledge, not a restriction on the ship's navigation computer,
        // and keeping the router unfiltered is what lets a mission's
        // faraway destination — drawn as a bare dot with no links — still
        // be plotted to.
        this.drawn = drawnSystems(
            visibleSystems.map(s => s.id).filter(
                id => this.discoveryOf(id) >= DISCOVERY_ENTERED),
            this.adj,
            [
                ...this.missionMarks.map(m => m.systemId),
                ...this.viewedMarks.map(m => m.systemId),
                // Somewhere this map exists to let the player PICK is
                // always drawn: a hypergate's destinations, and the
                // endpoints of the lanes the transit map is showing. The
                // gate's own network is knowledge the gate hands you.
                ...(this.selectable ?? []),
                ...gateLinks.flat(),
            ],
            currentSystem);
        this.clickTargets = this.pickRepresentativeSystems(
            visibleSystems.filter(s => this.drawn.has(s.id)));

        this.linkGraphics = new PIXI.Graphics();
        this.routeGraphics = new PIXI.Graphics();
        this.borderGraphics = new PIXI.Graphics();
        this.borderGraphics.visible = false;

        // Bounding box of all systems in laid-out (BASE_SCALE) coordinates.
        this.viewport = new MapViewport(this.container, size,
            worldBoundsOf(visibleSystems.map(s => s.position)));
        const mapContainer = this.viewport.mapContainer;
        // Borders sit under everything; the route overlays the links.
        mapContainer.addChild(this.borderGraphics);
        mapContainer.addChild(this.linkGraphics);
        mapContainer.addChild(this.routeGraphics);

        bindMapPointer(this.container, size, {
            pan: (dx, dy) => this.pan(dx, dy),
            zoomAt: (factor, x, y) => this.zoomBy(factor, x, y),
            tap: (x, y, shiftKey) => this.onTap(x, y, shiftKey),
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
            drawSystem(circleGraphics, x, y, discovered,
                this.isSystemInhabited(system));
            // The original labels only the systems the player has entered:
            // in map_zoomed_out_showing_far_away_mission.png every dim
            // #424242 dot is nameless, and every named one is blue or
            // #c6c6c6. A name is knowledge, like the dot's color.
            if (fontReady && discovered) {
                labelContainer.addChild(makeSystemLabel(system, x, y));
            }
        }
        mapContainer.addChild(circleGraphics);
        mapContainer.addChild(labelContainer);
        const marks = buildMissionMarks(this.systems, this.missionMarks,
            this.viewedMarks, options.missionMarkTextures);
        if (marks) {
            mapContainer.addChild(marks);
        }

        if (options.govtColorOf) {
            this.drawBorders(options.govtColorOf);
        }
        drawLinks(this.linkGraphics, this.links, this.gateLinks);
        if (this.selectable) {
            this.drawSelection();
        } else {
            this.drawRoute();
        }
        this.viewport.applyZoom();
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

    /** Pans the map by a screen-space delta (used by the arrow keys). */
    pan(dx: number, dy: number) {
        this.viewport.pan(dx, dy);
    }

    /**
     * Zooms by `factor`, keeping the point at (centerX, centerY) in the
     * viewport fixed. If no center is given, zooms around the viewport center.
     */
    zoomBy(factor: number, centerX?: number, centerY?: number) {
        this.viewport.zoomBy(factor, centerX, centerY);
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

    /** Draws the destination-picker overlay (starmap_draw.ts
     * drawSelectionOverlay) for the offered systems that are on the map. */
    private drawSelection() {
        if (!this.selectable) {
            this.routeGraphics.clear();
            return;
        }
        const offered: { system: SystemData, picked: boolean }[] = [];
        for (const id of this.selectable) {
            const system = this.systems.get(id);
            if (system) {
                offered.push({ system, picked: id === this.selectedSystem });
            }
        }
        drawSelectionOverlay(this.routeGraphics, offered);
    }

    /**
     * Draws the government border overlay (Show Borders): a blob of the
     * owning government's color around each governed system. Baked once
     * into its own layer and simply hidden until toggled on.
     */
    private drawBorders(govtColorOf: (system: SystemData) => number | null) {
        for (const { system, x, y } of this.clickTargets) {
            // Who owns a system is something you learn by going there: the
            // dim ring around the known galaxy contributes no territory.
            if (this.discoveryOf(system.id) < DISCOVERY_ENTERED) {
                continue;
            }
            const color = govtColorOf(system);
            if (color === null) {
                continue;
            }
            drawBorderBlob(this.borderGraphics, x, y, color);
        }
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
            this.samePlace);
        drawRouteOverlay(this.routeGraphics, {
            current: this.systems.get(this.currentSystem),
            single: this.single === undefined
                ? undefined : this.systems.get(this.single),
            multi: this.onMap(multi),
            pinned: this.onMap(this.pinned),
            info: this.infoSelected !== undefined
                && this.infoSelected !== this.currentSystem
                ? this.systems.get(this.infoSelected) : undefined,
        });
    }
}
