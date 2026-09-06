// The starmap dialog (nova:8509): the Menu that owns a SystemGraph
// (system_graph.ts) of the player's galaxy, the properties panel beside it
// (starmap_properties.ts), the button row and the keyboard controls, and
// hands the plotted route back to the plugin when the player presses Done.
import { GameDate } from "novadatainterface/player_start_data";
import { SystemData } from "novadatainterface/system_data";
import * as PIXI from 'pixi.js';
import { Observable } from "rxjs";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { ControlEvent } from "../nova_plugin/controls_plugin.js";
import { DISCOVERY_LANDED, DiscoveryLevel } from "../nova_plugin/discovery.js";
import { MissionMapMark } from "../nova_plugin/mission_logic.js";
import { systemIsInhabited } from "../nova_plugin/landable.js";
import { LegalRecordsState } from "../nova_plugin/reputation_plugin.js";
import { Button } from "./button.js";
import { FindDialog } from "./find_dialog.js";
import { Menu } from "./menu.js";
import { MenuControls } from "./menu_controls.js";
import { MissionUniverse } from "./mission_universe.js";
import { formatMapDate, reconcileRouteState, RouteState } from "./route.js";
import {
    MISSION_MARK_ACTIVE_CICN, MISSION_MARK_VIEWED_CICN, MissionMarkTextures,
} from "./starmap_marks.js";
import {
    DATE_FONT, DATE_RIGHT_X, HAZARDS_VALUE_X, HAZARDS_Y, PORTS_LABEL_X,
    PORTS_VALUE_X, PORTS_Y, PROP_LABEL_FONT, PROP_VALUE_FONT,
    renderPropertyLines, systemProperties,
} from "./starmap_properties.js";
import { KEY_PAN_STEP, ZOOM_STEP } from "./starmap_viewport.js";
import { SystemGraph } from "./system_graph.js";

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
    /**
     * The player's control bits, for NCB system visibility. Landed screens
     * pass the docked entity's: like the marks and the date, the bits live
     * on an entity that is out of the display world while docked, and a
     * map filtered against the plugin's empty fallback hid every
     * bXXX-gated system and resurrected every !bXXX stacked duplicate
     * (review finding #29). Omitted, the plugin's own lookup is used.
     */
    playerBits?: ReadonlySet<number>;
    /** The player's legal records, for the Legal Status line — passed by
     * landed screens for the same reason as `playerBits`. */
    legalRecords?: LegalRecordsState;
}

// Layout (container-centered like every menu): the nova:8509 dialog frame
// holds the 456x419 map pane at (-290,-248); the properties column sits to
// its right (starmap_properties.ts) and the button row below it, matching
// map_open_over_spaceport.png.
const MAP_POS = { x: -290, y: -248 };
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
    private missionMarkTextures?: MissionMarkTextures;
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
        /** How much the player knows about a system (discovery.ts). Gates
         * both what the map draws and how much of the properties column is
         * filled in; see showProperties. */
        private discoveryOf: (systemId: string) => DiscoveryLevel =
            () => DISCOVERY_LANDED,
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
        // A failed load must not sink buildPromise (which is built once
        // and awaited by every show()): the universe's load is retryable
        // (#66), and show() re-awaits it, so the map that could not open
        // during an outage opens on a later press.
        try {
            await this.universe.load();
        } catch (e) {
            console.warn('Starmap: mission universe failed to load; '
                + 'will retry when the map is next opened:', e);
        }
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
        // Discovery moves while the map is CLOSED (entering a system,
        // landing, buying a map outfit), and it decides which dots exist at
        // all — so it has to be part of the cache key, or a stale graph
        // would keep hiding a system the player has just flown into. One
        // digit per system: cheap to build, exactly precise.
        const discoveryKey = this.allSystems
            .map(s => this.discoveryOf(s.id)).join('');
        const key = [...bits].sort((a, b) => a - b).join(',')
            + '#' + marksKey + '#' + discoveryKey;
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
            discoveryOf: id => this.discoveryOf(id),
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
     * Fills the properties panel for a system (starmap_properties.ts
     * systemProperties): the right-hand column and the Ports / Navigation
     * Hazards readouts.
     *
     * The Legal Status line reads a landed caller's records over the
     * plugin's lookup, for the same reason as the bits (#29).
     */
    private showProperties(systemId: string) {
        // Cleared BEFORE the lines are computed (renderPropertyLines clears
        // again, harmlessly): a lookup that throws part-way must leave the
        // column blank, not the previous system's lines, as it always has.
        this.propContainer.removeChildren();
        const { lines, ports, hazards } = systemProperties(
            this.allSystems?.find(s => s.id === systemId),
            systemId === this.systemId, this.discoveryOf(systemId),
            this.universe,
            this.openOptions.legalRecords ?? this.getLegalRecords()
                ?? new Map());
        renderPropertyLines(this.propContainer, lines);
        this.portsValue.text = ports;
        this.hazardsValue.text = hazards;
    }

    override async show(route: string[]) {
        await this.buildPromise
        // Cheap once loaded (the same resolved promise); after a failed
        // load during build (#66) this is the retry, and a map without
        // its planet/govt/system indices is not shown — the throw reaches
        // the opener, which warns, exactly as a rejected buildPromise did,
        // except that the NEXT open can succeed.
        await this.universe.load();
        // The player's bits may have changed (missions, outfits) since
        // the graph was built; refilter NCB-gated systems. A landed
        // caller's bits win over the plugin's lookup (#29).
        this.rebuildGraph(this.openOptions.playerBits ?? this.getPlayerBits());
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
