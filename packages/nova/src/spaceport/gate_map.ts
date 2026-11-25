import { SystemData } from "novadatainterface/system_data";
import * as PIXI from "pixi.js";
import { Observable } from "rxjs";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { ControlEvent, isPort, landable } from '../nova_plugin/core/index.js';
import {
    DISCOVERY_LANDED, DiscoveryLevel,
} from "../nova_plugin/player/index.js";
import { MissionMapMark } from "../nova_plugin/missions/index.js";
import { Button } from "./button.js";
import {
    DEFAULT_HYPERGATE_TRANSITIVITY, gateMapDestinations, HypergateNetwork,
    parseHypergateTransitivity, reachableGates,
} from "./hypergate_network.js";
import { Menu } from "./menu.js";
import { MenuControls } from "./menu_controls.js";
import { MISSION_MARK_ACTIVE_CICN } from "./starmap_marks.js";
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
}

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
    /** The hypergate graph, destroyed gates marked unusable. */
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
    /** The gates of the current gate's network (its connected component),
     * the current gate included, sorted. */
    networkGates: string[];
    /** The hypergate lanes to draw, as system-id pairs: the lanes of the
     * current gate's network only. */
    gateLinks: [string, string][];
    /** system global id -> the destination spöb it stands for. */
    selectable: Map<string, string>;
}

/**
 * What the hypergate map shows for the gate the ship is docked at: ONLY the
 * hypergate network that gate belongs to.
 *
 * A data set can hold several networks with no lane between them — the
 * arpia plug-in's P-153 / P-173 / Residio gates (arpia:522-524) link only to
 * each other, never to a stock gate. Every lane used to be drawn, and its
 * endpoints were forced onto the map, so a player at a stock gate saw a
 * second, unreachable network floating in a corner (Matthew's playtest,
 * 2026-11-24). Now the lanes and the offered gates are both cut down to the
 * current gate's connected component.
 *
 * The component is the UNDIRECTED one, the same graph hypergate
 * transitivity walks (hypergate_network.ts hypergateAdjacency): a one-way
 * HyperLink still draws a lane between its two ends, so the lanes a player
 * sees stay one contiguous web. (arpia's finished Scheall gate, arpia:536,
 * links to stock HG-Koria nova:1418 one way; Koria's own links never name it.
 * Its network is therefore contiguous with the stock one: drawn from either
 * side, and selectable from Koria only under transitivity, exactly as
 * before.) With transitivity off the network is still drawn whole, so the
 * player sees where the lanes go, but only the gate's own HyperLinks are
 * selectable.
 *
 * The player's control bits decide which systems exist (the same NCB
 * visibility rule as the star map). A gate in no system the player can see
 * is not on the map for them: it is neither offered nor walked through, so a
 * hidden gate cannot join two networks the player can see. The gate the
 * ship is docked at always counts, even in a copy its bits say is hidden
 * (SystemGraph keeps the current system for the same reason). Each lane is
 * drawn between the VISIBLE copies of its gates' systems, so a story bit
 * that swaps a system for its stacked copy (HG-Heraan's nova:344 / 540 /
 * 604) keeps the lane instead of pointing it at a copy the map hides.
 *
 * Destroyed gates (unusable) stay out exactly as before. Pure, so it is
 * unit-testable: SystemGraph itself cannot be constructed headlessly.
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
    const network: HypergateNetwork = { links: index.network.links, unusable };

    const component = new Set(unusable.has(gateSpob)
        ? [gateSpob] : [gateSpob, ...reachableGates(network, gateSpob)]);

    const componentLinks = new Map<string, string[]>();
    for (const [from, destinations] of network.links) {
        if (!component.has(from) || unusable.has(from)) {
            continue;
        }
        componentLinks.set(from,
            destinations.filter(to => component.has(to) && !unusable.has(to)));
    }
    const systemOfSpob = new Map<string, string>();
    for (const gate of component) {
        const first = visibleSystemsOf(gate)[0];
        if (first !== undefined) {
            systemOfSpob.set(gate, first);
        }
    }

    const visibleSystemsOfSpob = new Map<string, string[]>();
    const destinations =
        gateMapDestinations(network, gateSpob, viewer.transitive);
    for (const dest of destinations) {
        visibleSystemsOfSpob.set(dest, visibleSystemsOf(dest));
    }

    return {
        networkGates: [...component].sort(),
        gateLinks: computeHypergateSystemLinks(systemOfSpob, componentLinks),
        selectable: computeSelectableSystems(visibleSystemsOfSpob,
            destinations),
    };
}

/**
 * The SystemGraph options the hypergate map draws itself with:
 * destination-PICKER mode (only the offered gates are clickable) with
 * the hypergate lanes drawn — plus the SAME orange active-mission arrows
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
    /** Spöb global ids that are PORTS (landable.ts isPort), for the blue
     * system dots. Omitted in tests, where the galaxy then draws grey. */
    portSpobs?: ReadonlySet<string>,
    /** How much the player knows about each system (discovery.ts). The
     * transit map obeys the same visibility rule as the star map, except
     * that the gate's own destinations and lanes are always drawn — you
     * cannot pick what you cannot see. Omitted in tests, which then get
     * the fully-known galaxy the map used to draw. */
    discoveryOf?: (systemId: string) => DiscoveryLevel,
    /** The docked ship's control bits: the map draws the systems that
     * exist under them, as the star map does. Omitted means no bits. */
    playerBits?: ReadonlySet<number>): SystemGraphOptions {
    return {
        gateLinks,
        selectable,
        missionMarks,
        ...(playerBits ? { playerBits } : {}),
        ...(discoveryOf ? { discoveryOf } : {}),
        ...(portSpobs
            ? {
                isSystemInhabited: (system: SystemData) =>
                    system.planets.some(p => portSpobs.has(p)),
            }
            : {}),
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
 * Unlike the regular starmap, this map DOES draw the hypergate lanes, and
 * instead of plotting a jump route it picks a destination.
 *
 * What it offers depends on the SERVER's `hypergateTransitivity` setting
 * (settings/settings.json, fetched through getSettings like controls.json):
 * with it off — the original game, EVN Bible p. 61 — only the current gate's
 * immediate neighbors are selectable; with it on, every gate in the same
 * hypergate NETWORK is, however many lanes away. The lanes themselves are
 * drawn either way, so a directly-linked destination is still visibly
 * one lane out while a transitive one is not.
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
    /** Spöbs that cannot be landed on — the destroyed gates. Neither a
     * destination nor a hop in the network walk. */
    private unlandableSpobs = new Set<string>();
    /** Spöbs that are PORTS (landable.ts isPort) — what makes a system's
     * dot blue on this map, exactly as on the star map. */
    private portSpobs = new Set<string>();
    /** The server's hypergateTransitivity setting, read in build(). */
    private transitivity = DEFAULT_HYPERGATE_TRANSITIVITY;
    private systemGraph?: SystemGraph;
    /** system global id -> the destination spöb that system represents. */
    private selectableSpobs = new Map<string, string>();
    /** The original's orange active-mission icon (cicn 15000), loaded once
     * in build() like the starmap's. Undefined in headless tests, where the
     * graph then draws no marks. */
    private missionMarkTexture?: PIXI.Texture;

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
        });
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
            if (!landable(planet)) {
                this.unlandableSpobs.add(spob);
            }
            if (isPort(planet.flags)) {
                this.portSpobs.add(spob);
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
    }

    /** The hypergate graph this map walks, as built in {@link build}. */
    private network(): HypergateNetwork {
        return { links: this.gateDestinations, unusable: this.unlandableSpobs };
    }

    override async show(input: GateMapResult): Promise<GateMapResult> {
        await this.buildPromise;

        // Only this gate's own network is drawn: its lanes, and the
        // systems the player may pick — every visible system containing one
        // of the gates this gate offers (its own links, or its whole
        // network when the server has hypergate transitivity on).
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
                this.missionMarkTexture, this.portSpobs,
                id => this.discoveryOf(id), playerBits));
        this.systemGraph.container.position.set(-290, -248);
        this.container.addChild(this.systemGraph.container);
        this.systemGraph.center();

        return super.show(input);
    }

    override done() {
        const selected = this.systemGraph?.selectedSystem;
        this.input.destinationSpob =
            (selected && this.selectableSpobs.get(selected)) || null;
        super.done();
    }
}
