import { PlanetData } from "novadatainterface/planet_data";
import { SystemData } from "novadatainterface/system_data";
import * as PIXI from "pixi.js";
import { Observable } from "rxjs";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { enhancementEnabled } from "../enhancements.js";
import { ControlEvent, landable } from '../nova_plugin/core/index.js';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DiscoveryLevel,
} from "../nova_plugin/player/index.js";
import { MissionMapMark } from "../nova_plugin/missions/index.js";
import { LegalRecordsState } from "../nova_plugin/reputation/index.js";
import { Button } from "./button.js";
import {
    DEFAULT_HYPERGATE_TRANSITIVITY, gateCycleOrder, gateMapDestinations,
    HypergateNetwork,
    hypergateReach, parseHypergateTransitivity,
} from "./hypergate_network.js";
import { Menu } from "./menu.js";
import { MenuControls } from "./menu_controls.js";
import { MissionUniverse } from "./mission_universe.js";
import {
    MapClearancePlayer, MapDotRule, mapDotRule, refusingSystems,
} from "./starmap.js";
import { GATE_MAP_LANE_COLOR, LANE_COLOR, MapRefusal } from "./starmap_draw.js";
import { MISSION_MARK_ACTIVE_CICN } from "./starmap_marks.js";
import {
    HAZARDS_VALUE_X, HAZARDS_Y, PORTS_LABEL_X, PORTS_VALUE_X, PORTS_Y,
    PROP_LABEL_FONT, PROP_VALUE_FONT, renderPropertyLines, systemProperties,
} from "./starmap_properties.js";
import { DEFAULT_ZOOM } from "./starmap_viewport.js";
import { SystemGraph, SystemGraphOptions } from "./system_graph.js";
import {
    computeHypergateSystemLinks, systemVisible,
} from "./system_graph_data.js";

/**
 * What the hypergate map is asked to pick, and its answer. `destinationSpob`
 * comes back as the chosen destination gate's spöb global id, or null if the
 * map was closed without a pick (the ship lifts off from the origin gate).
 */
export interface GateMapResult {
    /** The gate the ship is docked at (spöb global id). */
    gateSpob: string;
    /** The current system (global id), for centering the map. */
    systemId: string;
    /** Out: the picked neighbor gate's spöb global id, or null. */
    destinationSpob: string | null;
    /**
     * The player's active-mission map marks (the orange arrows the regular
     * starmap draws). Passed in by the caller because the docked ship — and
     * with it the Missions component — is out of the display world while the
     * gate map has it, exactly like the spaceport's OpenStarmapOptions
     * .missionMarks. Omitted / empty means no marks.
     */
    missionMarks?: MissionMapMark[];
    /**
     * The docked ship's control bits, for NCB system visibility: which
     * copy of a stacked system is drawn, and which gates exist at all
     * (see {@link computeGateMapView}). Passed in for the same reason as
     * `missionMarks`. Omitted means no bits (a new pilot).
     */
    playerBits?: ReadonlySet<number>;
    /** The docked ship's legal records, for the column's Legal Status
     * line. Passed in for the same reason as `missionMarks`. Omitted means
     * none (every system reads its status govt's InitialRec). */
    legalRecords?: LegalRecordsState;
    /**
     * The docked ship's landing-clearance inputs, for the ORANGE / RED
     * dots: the same ones the star map reads (starmap.ts
     * MapClearancePlayer, refusingSystems), passed in for the same reason
     * as `missionMarks`. Omitted, no system is drawn orange or red.
     */
    clearancePlayer?: MapClearancePlayer;
}

/**
 * The colour the gate map draws the ORDINARY hyperspace lanes in. The
 * original draws them nearly black, #080808 (measured, reference "Gate map,
 * wave 27"); NovaJS draws them the star map's #4a4a4a so the routes between
 * gates read at a glance (Matthew's playtest, 2026-11-26: "we should do it
 * since it makes it easier to see"), unless the player turns the
 * `enhGateMapLanes` enhancement off. The cyan gate arrows stay above them
 * either way (SystemGraph's gate layer is over the lanes and the dots).
 */
export function gateMapLaneColor(
    showLanes = enhancementEnabled('enhGateMapLanes')): number {
    return showLanes ? LANE_COLOR : GATE_MAP_LANE_COLOR;
}

/** The column's first caption once a destination is picked (reference
 * "Gate map, wave 24": "Hypergate Destination: Kit Gate A2"; "wave 27":
 * "Hypergate Destination: <Unknown>" for an unexplored one). */
export const HYPERGATE_DESTINATION_TITLE = 'Hypergate Destination:';
/** The bottom line while nothing is picked, in the caption grey, centred
 * where the Ports / Navigation Hazards readouts go once something is
 * (reference "Gate map, wave 24"; ink 330..511 x 499..507 in wave 27's
 * `04-map.png`, i.e. about 4 px right of the dialog's centre and 12 px
 * under the Ports row). */
export const GATE_MAP_PROMPT = '- Please select a hypergate destination -';
const GATE_MAP_PROMPT_X = 4;
const GATE_MAP_PROMPT_Y = PORTS_Y + 12;

/**
 * Computes the systems the hypergate map offers for a gate: every system
 * containing one of the gate's linked destination gates, each mapped back to
 * that destination's spöb global id. Stacked NCB copies of a system can share
 * a gate, so several systems may map to the same spöb — whichever copy the
 * map displays resolves to the right destination. Pure and unit-testable.
 */
export function computeSelectableSystems(
    systemsOfSpob: Map<string, string[]>,
    destinations: string[]): Map<string, string> {
    const selectable = new Map<string, string>();
    for (const dest of destinations) {
        for (const systemId of systemsOfSpob.get(dest) ?? []) {
            selectable.set(systemId, dest);
        }
    }
    return selectable;
}

/** What {@link computeGateMapView} works from: the galaxy as GateMap.build()
 * indexes it. */
export interface GateMapIndex {
    /** Every system, by global id (for the NCB visibility test). */
    systemById: ReadonlyMap<string, SystemData>;
    /** spöb global id -> containing system global ids, in data order
     * (stacked NCB copies of a system can share a gate). */
    systemsOfSpob: ReadonlyMap<string, readonly string[]>;
    /** The hypergate graph, destroyed gates marked `destroyed`. */
    network: HypergateNetwork;
}

/** Where the player is standing, and what they know. */
export interface GateMapViewer {
    /** The gate the ship is docked at (spöb global id). */
    gateSpob: string;
    /** The system the ship is in (global id). */
    systemId: string;
    /** The server's hypergateTransitivity setting. */
    transitive: boolean;
    /** The docked ship's control bits, for NCB system visibility. */
    playerBits: ReadonlySet<number>;
}

/** What the hypergate map draws and offers for one showing. */
export interface GateMapView {
    /** The gates a chain of transits reaches from the current gate
     * (hypergate_network.ts reachableGates), the current gate included,
     * sorted. What transitivity offers; with it off, only the gate's own
     * links are offered and drawn. */
    networkGates: string[];
    /** The hypergate lanes to draw, as DIRECTED system-id pairs (from, to):
     * each is drawn as an arrow pointing at `to`. */
    gateLinks: [string, string][];
    /** system global id -> the destination spöb it stands for. */
    selectable: Map<string, string>;
    /** Selectable system id -> the lanes (directed system pairs) a pick of
     * it follows, drawn WHITE while it is picked: the one lane to it, or
     * under transitivity the shortest chain of lanes. */
    routes: Map<string, [string, string][]>;
    /** The selectable systems in the order Tab picks them
     * (hypergate_network.ts gateCycleOrder: the gate's HyperLink slots),
     * one system per destination gate. */
    cycle: string[];
}

/**
 * What the hypergate map shows for the gate the ship is docked at.
 *
 * MEASURED (docs/reference_experiments.md, "Gate map, wave 24": three Kit
 * Gate networks, A1 <-> A2, B1 <-> B2 and C1 -> C2 one way, C2 <-> C3):
 * the original draws ONLY the current gate's own HyperLinks, each as a cyan
 * (#00adef) ARROW from the current system to the destination, and only
 * those destinations are selectable; the picked lane turns white. The rest
 * of the gate's own network (no C2 - C3 lane at C1), other networks (no B1
 * - B2 lane at A1) and one-way lanes INTO the gate (at C2 the C1 -> C2 lane
 * is neither drawn nor selectable) get no lanes at all: their systems are
 * ordinary map dots. This supersedes 16a1b6c4's connected-network drawing
 * (Matthew, 2026-11-24, "don't show non-contiguous networks": the arpia
 * plug-in's P-153 / P-173 / Residio gates no longer show from a stock gate,
 * and neither does any lane but the gate's own).
 *
 * With the server's hypergate TRANSITIVITY on (a NovaJS addition,
 * settings/settings.json), a gate offers every gate a chain of its links
 * reaches, each link followed in its own direction (hypergate_network.ts),
 * so a one-way lane is still never offered from its far end. The map then
 * draws the lanes of that chain, as arrows pointing AWAY from the current
 * gate (each lane once, from the gate nearer to the current one; a lane
 * between two gates the same number of hops out keeps whichever directions
 * it has), so every offered gate is visibly connected; picking a far gate
 * whitens the shortest chain to it. Gates the chain cannot reach — other
 * networks, the far side of a one-way lane — stay plain dots, as without
 * transitivity.
 *
 * The player's control bits decide which systems exist (the same NCB
 * visibility rule as the star map). A gate in no system the player can see
 * is not on the map for them: it is neither offered nor walked through. The
 * gate the ship is docked at always counts, even in a copy its bits say is
 * hidden (SystemGraph keeps the current system for the same reason). Each
 * lane is drawn between the VISIBLE copies of its gates' systems, so a story
 * bit that swaps a system for its stacked copy (HG-Heraan's nova:344 / 540 /
 * 604) keeps the lane instead of pointing it at a copy the map hides.
 *
 * An UNEXPLORED destination is offered like any other (measured,
 * reference "Gate map, wave 27", Kit Gate N1 with N2 and N3 unexplored,
 * N2 a hyperspace neighbour and N3 not: each is drawn as a #424242 ring
 * with no label under its arrowhead, one click selects it, the column
 * reads "Hypergate Destination: <Unknown>", and Done transits). Exploration
 * decides only how the dot and the column read (SystemGraph forces every
 * offered destination onto the map, dim until entered). Wave 25's "no dot,
 * not selectable" was a misread (its click fell 54 px short of A2).
 *
 * A DESTROYED gate (hypergate_network.ts `destroyed`: it fails landable())
 * that the gate links to is drawn, offered and cycled like any other
 * destination, in its HyperLink slot, and a transit to it puts the ship
 * there (measured, reference "Tab on the hypergate map, wave 56", run b:
 * HG-Tichel linked to the destroyed HG-Aldebaran got a fourth arrow, Tab
 * picked it third, and Done exited "in the Aldebaran system"). It offers
 * nothing onward, so under transitivity the chain stops at it. No stock
 * gate links to a destroyed one; only plug-in data shows this.
 *
 * Pure, so it is unit-testable: SystemGraph itself cannot be constructed
 * headlessly.
 */
export function computeGateMapView(index: GateMapIndex,
    viewer: GateMapViewer): GateMapView {
    const { gateSpob, systemId, playerBits } = viewer;
    const visibleCache = new Map<string, string[]>();
    /** The systems holding `spob` that the player can see, the current
     * system first. */
    const visibleSystemsOf = (spob: string): string[] => {
        let visible = visibleCache.get(spob);
        if (!visible) {
            visible = (index.systemsOfSpob.get(spob) ?? []).filter(id => {
                if (id === systemId) {
                    return true;
                }
                const system = index.systemById.get(id);
                return system !== undefined
                    && systemVisible(system, playerBits);
            }).sort((a, b) => Number(b === systemId) - Number(a === systemId));
            visibleCache.set(spob, visible);
        }
        return visible;
    };

    // Gates on no visible system are, for this player, not there at all.
    const unusable = new Set(index.network.unusable ?? []);
    const gates = new Set<string>();
    for (const [from, destinations] of index.network.links) {
        gates.add(from);
        for (const to of destinations) {
            gates.add(to);
        }
    }
    for (const gate of gates) {
        if (gate !== gateSpob && visibleSystemsOf(gate).length === 0) {
            unusable.add(gate);
        }
    }
    const destroyed = index.network.destroyed ?? new Set<string>();
    const network: HypergateNetwork = {
        links: index.network.links, unusable, destroyed,
    };

    const reach = hypergateReach(network, gateSpob);
    const destinations =
        gateMapDestinations(network, gateSpob, viewer.transitive);

    // The lanes, gate to gate, each pointing away from the current gate.
    const lanes = new Map<string, string[]>();
    const addLane = (from: string, to: string) => {
        const onward = lanes.get(from) ?? [];
        if (!onward.includes(to)) {
            onward.push(to);
        }
        lanes.set(from, onward);
    };
    if (viewer.transitive) {
        for (const [from, hopsFrom] of reach.hops) {
            // A destroyed gate is the end of its lane: nothing departs it.
            if (destroyed.has(from)) {
                continue;
            }
            for (const to of network.links.get(from) ?? []) {
                const hopsTo = reach.hops.get(to);
                if (hopsTo !== undefined && to !== gateSpob
                    && hopsTo >= hopsFrom) {
                    addLane(from, to);
                }
            }
        }
    } else {
        for (const to of destinations) {
            addLane(gateSpob, to);
        }
    }

    const systemOfSpob = new Map<string, string>();
    for (const gate of reach.hops.keys()) {
        const first = visibleSystemsOf(gate)[0];
        if (first !== undefined) {
            systemOfSpob.set(gate, first);
        }
    }

    const visibleSystemsOfSpob = new Map<string, string[]>();
    for (const dest of destinations) {
        visibleSystemsOfSpob.set(dest, visibleSystemsOf(dest));
    }
    const selectable = computeSelectableSystems(visibleSystemsOfSpob,
        destinations);

    // What a pick whitens: the lane to it, or the shortest chain.
    const routes = new Map<string, [string, string][]>();
    for (const [pickedSystem, dest] of selectable) {
        // The chain's hops, from the current gate outward.
        const hops: [string, string[]][] = [];
        if (viewer.transitive) {
            for (let at = dest; reach.via.has(at);) {
                const from = reach.via.get(at)!;
                hops.unshift([from, [at]]);
                at = from;
            }
        } else {
            hops.push([gateSpob, [dest]]);
        }
        const chain = new Map(hops);
        // The picked copy of a stacked system is the lane's head.
        const route = computeHypergateSystemLinks(systemOfSpob, chain)
            .map(([from, to]): [string, string] => [from,
                visibleSystemsOf(dest).includes(to) ? pickedSystem : to]);
        routes.set(pickedSystem, route);
    }

    // Tab's order: the destination gates in HyperLink slot order, each as
    // the first visible system the map offers it in.
    const cycle: string[] = [];
    for (const gate of gateCycleOrder(network, gateSpob, viewer.transitive)) {
        const system = visibleSystemsOf(gate)
            .find(id => selectable.get(id) === gate);
        if (system !== undefined && !cycle.includes(system)) {
            cycle.push(system);
        }
    }

    return {
        networkGates: [...reach.hops.keys()].sort(),
        gateLinks: computeHypergateSystemLinks(systemOfSpob, lanes),
        selectable,
        routes,
        cycle,
    };
}

/**
 * The SystemGraph options the hypergate map draws itself with:
 * destination-PICKER mode (only the offered gates are clickable) with
 * the hypergate lanes drawn as arrows, and the lanes a pick follows
 * (`gateRoutes`, whitened while picked) — plus the SAME orange active-mission arrows
 * the regular starmap shows. A hypergate map is still a map, and choosing
 * a gate is exactly when the player wants to see where their missions
 * are; the marks are a decorative overlay that never affects what is
 * selectable (destinations come from the gate's own HyperLinks, or from
 * its whole network under hypergate transitivity — see
 * {@link computeGateMapView}).
 *
 * Pure, so the wiring is unit-testable: SystemGraph itself cannot be
 * constructed headlessly (PIXI.Graphics wants a canvas).
 */
export function gateMapGraphOptions(gateLinks: [string, string][],
    selectable: Set<string>, missionMarks: MissionMapMark[] = [],
    missionMarkTexture?: PIXI.Texture,
    /** How each dot is coloured: the star map's own rule (starmap.ts
     * mapDotRule) — blue for a system a non-gate port settles, grey
     * without one, orange / red where every port refuses the player.
     * The original draws every gate-map dot as an ordinary map dot
     * (reference "Gate map, wave 27"). Omitted in tests, where the galaxy
     * then draws grey. */
    dots?: MapDotRule,
    /** How much the player knows about each system (discovery.ts). The
     * transit map obeys the same visibility rule as the star map, except
     * that the gate's offered destinations are always drawn: an
     * unexplored one as the dim unlabeled ring (reference "Gate map, wave
     * 27"). Omitted in tests, which then get the fully-known galaxy the
     * map used to draw. */
    discoveryOf?: (systemId: string) => DiscoveryLevel,
    /** The docked ship's control bits: the map draws the systems that
     * exist under them, as the star map does. Omitted means no bits. */
    playerBits?: ReadonlySet<number>,
    /** {@link GateMapView.routes}: the lanes each pick whitens. */
    gateRoutes?: ReadonlyMap<string, [string, string][]>,
    /** The ordinary lanes' colour ({@link gateMapLaneColor}); omitted, the
     * original's nearly black one. */
    laneColor = GATE_MAP_LANE_COLOR,
    /** {@link GateMapView.cycle}: the order Tab picks the offered
     * systems in. Omitted, Tab picks nothing. */
    cycle?: readonly string[]): SystemGraphOptions {
    return {
        gateLinks,
        selectable,
        laneColor,
        ...(cycle ? { selectableOrder: cycle } : {}),
        ...(gateRoutes ? { gateRoutes } : {}),
        missionMarks,
        ...(playerBits ? { playerBits } : {}),
        ...(discoveryOf ? { discoveryOf } : {}),
        ...(dots ?? {}),
        // The map draws active marks only; the green BBS-viewed marks
        // belong to the mission computer's map. Both slots take the one
        // texture because SystemGraph asks for the pair, and with no
        // viewedMarks the second is never used.
        ...(missionMarkTexture
            ? {
                missionMarkTextures: {
                    active: missionMarkTexture, viewed: missionMarkTexture,
                },
            }
            : {}),
    };
}

/**
 * The hypergate transit map: shown when the player lands on a hypergate.
 * Unlike the regular starmap, this map DOES draw hypergate lanes — the
 * current gate's own, as arrows — and instead of plotting a jump route it
 * picks a destination (see {@link computeGateMapView}). Done with no pick
 * lifts the ship off at the gate, in the same system (measured, reference
 * "Gate map, wave 24"; client/transit.ts leaveGateMap), and the status line
 * says "Hypergate jump cancelled." (reference "Wave-24 leftovers, wave 25";
 * display/gate_map_plugin.ts GateMapCancelledSystem).
 *
 * What it offers depends on the SERVER's `hypergateTransitivity` setting
 * (settings/settings.json, fetched through getSettings like controls.json):
 * with it off — the original game, EVN Bible p. 61 — only the current gate's
 * own HyperLinks are drawn and selectable; with it on, every gate a chain of
 * those links reaches is, however many lanes away, with the chain's lanes
 * drawn so each one is visibly connected.
 *
 * Reuses the starmap's SystemGraph (bitmap-font labels, baked circle
 * batching, pan/zoom) in its destination-picker mode.
 *
 * Player-local landed UI, like the spaceport: nothing here touches the
 * simulation. The browser applies the result through the same machinery a
 * hyperspace jump uses.
 */
export class GateMap extends Menu<GateMapResult> {
    private systems: SystemData[] = [];
    private systemById = new Map<string, SystemData>();
    /** spöb global id -> containing system global ids (stacked NCB copies
     * of a system can share a gate, so a spöb can appear in several). */
    private systemsOfSpob = new Map<string, string[]>();
    /** Hypergate spöb global id -> its destination spöb global ids. */
    private gateDestinations = new Map<string, string[]>();
    /** Spöbs that cannot be landed on — the destroyed gates. A destination
     * a working gate's link may name, but never a gate to travel on from
     * (hypergate_network.ts `destroyed`). */
    private unlandableSpobs = new Set<string>();
    /** Every stellar in a system, by global id, for the dot colours: the
     * star map's rule (starmap.ts mapDotRule), so a gate settles nothing —
     * the gate-only Kit Gate systems are #c6c6c6 on the original's gate
     * map ("Gate map, wave 24"), as VNP-001 is on its star map ("Map dot
     * colours, wave 23"). */
    private planets = new Map<string, PlanetData>();
    /** The server's hypergateTransitivity setting, read in build(). */
    private transitivity = DEFAULT_HYPERGATE_TRANSITIVITY;
    private systemGraph?: SystemGraph;
    /** system global id -> the destination spöb that system represents. */
    private selectableSpobs = new Map<string, string>();
    /** The original's orange active-mission icon (cicn 15000), loaded once
     * in build() like the starmap's. Undefined in headless tests, where the
     * graph then draws no marks. */
    private missionMarkTexture?: PIXI.Texture;
    /** Planets and governments for the properties column (shared with the
     * star map; loaded in build()). */
    private universe?: MissionUniverse;
    /** The right-hand column, as the star map's (starmap_properties.ts). */
    private propContainer = new PIXI.Container();
    private portsLabel = new PIXI.Text('Ports:', PROP_LABEL_FONT);
    private portsValue = new PIXI.Text('', PROP_VALUE_FONT);
    private hazardsLabel = new PIXI.Text('Navigation Hazards:',
        PROP_LABEL_FONT);
    private hazardsValue = new PIXI.Text('', PROP_VALUE_FONT);
    private prompt = new PIXI.Text(GATE_MAP_PROMPT, PROP_LABEL_FONT);

    constructor(displayAssets: DisplayAssetDataInterface,
        simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>,
        /** How much the player knows about each system (discovery.ts).
         * Defaults to "landed", i.e. the fully-drawn galaxy this map
         * showed before discovery existed. */
        private discoveryOf: (systemId: string) => DiscoveryLevel =
            () => DISCOVERY_LANDED) {
        super(displayAssets, simulationData, "nova:8509", controlEvents);
        this.container.name = "GateMap";
        const buttons = {
            done: new Button(displayAssets, "Done", 120, { x: 150, y: 220 }),
        };
        this.addButtons(buttons);
        buttons.done.click.subscribe(this.done.bind(this));

        this.controls = new MenuControls(controlEvents, {
            depart: this.done.bind(this),
            map: this.done.bind(this),
            // Tab picks the next destination gate, as the star map's Tab
            // picks the next neighbour (reference "Tab on the hypergate
            // map, wave 56").
            nextTarget: () => this.systemGraph?.cycleSingleRoute(1),
        });
        // Return presses Done: on the original it transited to the Tab's
        // pick (reference "Tab on the hypergate map, wave 56").
        this.controls.defaultButton = this.done.bind(this);
    }

    override async build() {
        await super.build();
        // The active-mission icon, loaded through the same textureFromCicn
        // path the starmap uses. A missing icon must not take the gate map
        // down with it — the map's job is picking a destination.
        try {
            this.missionMarkTexture = await this.displayAssets
                .textureFromCicn(MISSION_MARK_ACTIVE_CICN);
        } catch {
            this.missionMarkTexture = undefined;
        }
        // The column's planets / govts. A failed load leaves the column
        // with names only (systemProperties copes with missing lookups);
        // the map's job is picking a destination.
        const universe = MissionUniverse.shared(this.simulationData);
        try {
            await universe.load();
            this.universe = universe;
        } catch (e) {
            console.warn('Gate map: mission universe failed to load', e);
        }
        const ids = await this.simulationData.ids;
        this.systems = await Promise.all(
            ids.System.map(s => this.simulationData.data.System.get(s)));
        this.systemById = new Map(this.systems.map(s => [s.id, s]));

        for (const system of this.systems) {
            for (const spob of system.planets) {
                const all = this.systemsOfSpob.get(spob) ?? [];
                all.push(system.id);
                this.systemsOfSpob.set(spob, all);
            }
        }
        await Promise.all([...this.systemsOfSpob.keys()].map(async spob => {
            let planet;
            try {
                planet = await this.simulationData.data.Planet.get(spob);
            } catch {
                return;
            }
            this.planets.set(spob, planet);
            if (!landable(planet)) {
                this.unlandableSpobs.add(spob);
            }
            if (planet.gate?.kind === 'hypergate') {
                this.gateDestinations.set(spob, planet.gate.destinations);
            }
        }));

        // How far a single transit may reach is the SERVER's call, not the
        // player's: it comes from settings/settings.json (the same file the
        // jump visual lives in), which the server serves to every client, so
        // everyone in a room sees the same destinations offered. Nothing in
        // the simulation reads it — the chosen gate rides the ship's
        // GateArrivalComponent as an explicit spöb id — so a client that
        // never loads it just gets the original's adjacent-only map.
        try {
            this.transitivity = parseHypergateTransitivity(
                await this.simulationData.getSettings?.('settings.json'));
        } catch (e) {
            console.warn('Failed to load settings.json for the gate map', e);
        }

        this.portsLabel.position.set(PORTS_LABEL_X, PORTS_Y);
        this.portsValue.position.set(PORTS_VALUE_X, PORTS_Y);
        this.hazardsLabel.position.set(PORTS_LABEL_X, HAZARDS_Y);
        this.hazardsValue.position.set(HAZARDS_VALUE_X, HAZARDS_Y);
        this.prompt.anchor.x = 0.5;
        this.prompt.position.set(GATE_MAP_PROMPT_X, GATE_MAP_PROMPT_Y);
        this.container.addChild(this.propContainer, this.portsLabel,
            this.portsValue, this.hazardsLabel, this.hazardsValue,
            this.prompt);
    }

    /**
     * Fills the column (reference "Gate map, wave 24" / "wave 27"): with
     * nothing picked, "Current System: <name>" and the rest of the star
     * map's column for it, and the prompt line at the bottom; once a
     * destination is picked, "Hypergate Destination: <name>" (or
     * "<Unknown>", unexplored) with its Ports / Navigation Hazards
     * readouts in the prompt's place.
     */
    private showProperties(systemId: string, picked: boolean,
        legalRecords: LegalRecordsState) {
        this.propContainer.removeChildren();
        const universe = this.universe;
        const { lines, ports, hazards } = systemProperties(
            this.systemById.get(systemId), !picked,
            this.discoveryOf(systemId),
            universe ?? {
                getGovt: () => undefined, getPlanet: () => undefined,
            },
            legalRecords,
            picked ? HYPERGATE_DESTINATION_TITLE : undefined);
        renderPropertyLines(this.propContainer, lines);
        this.portsValue.text = ports;
        this.hazardsValue.text = hazards;
        for (const readout of [this.portsLabel, this.portsValue,
            this.hazardsLabel, this.hazardsValue]) {
            readout.visible = picked;
        }
        this.prompt.visible = !picked;
    }

    /** What the column shows right now, for specs and headless driving. */
    get propertiesText(): string[] {
        const texts: string[] = [];
        for (const child of this.propContainer.children) {
            if (child instanceof PIXI.Text) {
                texts.push(child.text);
            }
        }
        if (this.prompt.visible) {
            texts.push(this.prompt.text);
        } else {
            texts.push(`Ports: ${this.portsValue.text}`,
                `Navigation Hazards: ${this.hazardsValue.text}`);
        }
        return texts;
    }

    /** Picks `systemId` as a pointer click on it would, for specs and
     * headless driving; ignored for a system the map does not offer. */
    pickSystem(systemId: string) {
        this.systemGraph?.clickSystem(systemId);
    }

    /** The dots to draw orange / red for `player`: the star map's own
     * {@link refusingSystems}, over the explored systems. */
    private refusingSystems(player: MapClearancePlayer | undefined,
        legalRecords: LegalRecordsState | undefined):
        ReadonlyMap<string, MapRefusal> {
        if (!player || !this.universe) {
            return new Map();
        }
        return refusingSystems(this.systems, this.universe,
            { ...player, records: legalRecords ?? player.records },
            id => this.discoveryOf(id) >= DISCOVERY_ENTERED,
            id => this.simulationData.data.Outfit.getCached(id)?.contribute);
    }

    /** The graph this showing draws, for specs and headless driving. */
    get graph(): SystemGraph | undefined {
        return this.systemGraph;
    }

    /** The hypergate graph this map walks, as built in {@link build}. */
    private network(): HypergateNetwork {
        return { links: this.gateDestinations, destroyed: this.unlandableSpobs };
    }

    override async show(input: GateMapResult): Promise<GateMapResult> {
        await this.buildPromise;

        // Only this gate's own lanes are drawn, as arrows, and only the
        // systems the player may pick are clickable — every visible system
        // containing one of the gates this gate offers (its own links, or
        // the chain they reach when the server has transitivity on).
        const playerBits = input.playerBits ?? new Set<number>();
        const view = computeGateMapView({
            systemById: this.systemById,
            systemsOfSpob: this.systemsOfSpob,
            network: this.network(),
        }, {
            gateSpob: input.gateSpob, systemId: input.systemId,
            transitive: this.transitivity, playerBits,
        });
        this.selectableSpobs = view.selectable;

        // A fresh graph per showing: the selectable set is per-gate. The
        // heavy pieces (bitmap label font, texture batching) are shared and
        // this only happens when the player lands on a gate.
        if (this.systemGraph) {
            this.container.removeChild(this.systemGraph.container);
        }
        this.systemGraph = new SystemGraph(this.systems, input.systemId,
            gateMapGraphOptions(view.gateLinks,
                new Set(this.selectableSpobs.keys()), input.missionMarks,
                this.missionMarkTexture,
                mapDotRule(id => this.planets.get(id),
                    this.refusingSystems(input.clearancePlayer,
                        input.legalRecords)),
                id => this.discoveryOf(id), playerBits, view.routes,
                gateMapLaneColor(), view.cycle));
        // The original's opening scale, the star map's (Kit Gate A1 -> A2,
        // 120 map units, 212 px apart: "Gate map, wave 24").
        this.systemGraph.zoomBy(DEFAULT_ZOOM);
        this.systemGraph.container.position.set(-290, -248);
        // Under the column and readouts, as on the star map.
        this.container.addChildAt(this.systemGraph.container,
            Math.min(1, this.container.children.length));
        this.systemGraph.center();
        const legalRecords = input.legalRecords ?? new Map();
        this.showProperties(input.systemId, false, legalRecords);
        this.systemGraph.infoSelection.subscribe(
            id => this.showProperties(id, true, legalRecords));

        return super.show(input);
    }

    override done() {
        const selected = this.systemGraph?.selectedSystem;
        this.input.destinationSpob =
            (selected && this.selectableSpobs.get(selected)) || null;
        super.done();
    }
}
