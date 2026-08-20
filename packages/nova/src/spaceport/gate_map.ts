import { SystemData } from "novadatainterface/system_data";
import * as PIXI from "pixi.js";
import { Observable } from "rxjs";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { ControlEvent } from "../nova_plugin/controls_plugin.js";
import {
    DISCOVERY_LANDED, DiscoveryLevel,
} from "../nova_plugin/discovery.js";
import { isPort, landable } from "../nova_plugin/landable.js";
import { MissionMapMark } from "../nova_plugin/mission_logic.js";
import { Button } from "./button.js";
import {
    DEFAULT_HYPERGATE_TRANSITIVITY, gateMapDestinations, HypergateNetwork,
    parseHypergateTransitivity,
} from "./hypergate_network.js";
import { Menu } from "./menu.js";
import { MenuControls } from "./menu_controls.js";
import {
    computeHypergateSystemLinks, MISSION_MARK_ACTIVE_CICN, SystemGraph,
    SystemGraphOptions,
} from "./starmap.js";

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

/**
 * Exactly what {@link GateMap.show} offers: the gate's destinations under the
 * server's `hypergateTransitivity` setting (its own HyperLinks when off, its
 * whole hypergate network when on), mapped to the systems that contain them.
 * Pure, so the map's actual offering is unit-testable — SystemGraph itself
 * cannot be constructed headlessly.
 */
export function computeGateMapSelection(
    systemsOfSpob: Map<string, string[]>,
    network: HypergateNetwork,
    gateSpob: string,
    transitive: boolean): Map<string, string> {
    return computeSelectableSystems(systemsOfSpob,
        gateMapDestinations(network, gateSpob, transitive));
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
 * {@link computeGateMapSelection}).
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
    discoveryOf?: (systemId: string) => DiscoveryLevel): SystemGraphOptions {
    return {
        gateLinks,
        selectable,
        missionMarks,
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
    private gateLinks: [string, string][] = [];
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

        const systemOfSpob = new Map<string, string>();
        for (const system of this.systems) {
            for (const spob of system.planets) {
                if (!systemOfSpob.has(spob)) {
                    systemOfSpob.set(spob, system.id);
                }
                const all = this.systemsOfSpob.get(spob) ?? [];
                all.push(system.id);
                this.systemsOfSpob.set(spob, all);
            }
        }
        await Promise.all([...systemOfSpob.keys()].map(async spob => {
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
        this.gateLinks =
            computeHypergateSystemLinks(systemOfSpob, this.gateDestinations);

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

        // The systems the player may pick: every system containing one of
        // the gates this gate offers — its own links, or its whole network
        // when the server has hypergate transitivity on.
        this.selectableSpobs = computeGateMapSelection(this.systemsOfSpob,
            this.network(), input.gateSpob, this.transitivity);

        // A fresh graph per showing: the selectable set is per-gate. The
        // heavy pieces (bitmap label font, texture batching) are shared and
        // this only happens when the player lands on a gate.
        if (this.systemGraph) {
            this.container.removeChild(this.systemGraph.container);
        }
        this.systemGraph = new SystemGraph(this.systems, input.systemId,
            gateMapGraphOptions(this.gateLinks,
                new Set(this.selectableSpobs.keys()), input.missionMarks,
                this.missionMarkTexture, this.portSpobs,
                id => this.discoveryOf(id)));
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
