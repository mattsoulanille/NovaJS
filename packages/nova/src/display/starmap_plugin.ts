import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import { EcsEvent } from 'nova_ecs/events';
import { Subscription } from 'rxjs';
import { Component } from 'nova_ecs/component';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { OutfitData } from 'novadatainterface/outfit_data';
import {
    DisplayAssetDataResource, SimulationGameDataResource, ControlsSubject, SystemIdResource,
} from '../nova_plugin/core/index.js';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DiscoveryLevel, DiscoveryStoreResource,
    PlayerShipSelector, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import {
    OutfitsStateComponent, ShipDataComponent,
} from '../nova_plugin/ship/index.js';
import { applyOwnedMapOutfits } from '../spaceport/map_outfit.js';
import {
    JumpComponent, JumpRouteComponent, StellarBribesComponent,
} from '../nova_plugin/travel/index.js';
import { MissionMapMark, missionMapMarks } from '../nova_plugin/missions/index.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { emptyRouteState } from '../spaceport/route.js';
import { OpenStarmapOptions, RouteStateStore, Starmap } from '../spaceport/starmap.js';
import {
    MINI_MAP_PANE, MINI_MAP_ZOOM, MiniMap, MiniMapPeek, miniMapPosition,
} from '../spaceport/mini_map.js';
import type { SystemGraph } from '../spaceport/system_graph.js';
import { DockedShipResource } from './docked_ship.js';
import { SimulationTimeResource } from './simulation_time.js';
import {
    keepCentred, ScreenSize, stopCentring,
} from './screen_size_plugin.js';
import { StatusBarResource } from './status_bar_resource.js';
import { Stage } from './stage_resource.js';
import { BEEP_MAP_CLOSE, BEEP_MAP_OPEN, playUiSound } from './ui_sound.js';

export const StarmapResource = new Resource<Starmap>("Starmap");
const StarmapControlsSubscription = new Resource<Subscription>('StarmapControlsSubscription');
/** Marks the plugin's openStarmap as torn down (see remove). */
const StarmapDisposer = new Resource<() => void>('StarmapDisposer');
export const SetJumpRouteEvent = new EcsEvent<{ route: string[] }>('SetJumpRouteEvent');

/** The `window.novaDiscovery` levers (see window_hooks.ts). */
export interface DiscoveryHooks {
    level(id: string): DiscoveryLevel;
    mark(ids: string[], level: DiscoveryLevel): void;
    markAll(level?: DiscoveryLevel): Promise<void>;
}

/** The `window.novaMiniMap` levers (see window_hooks.ts). */
export interface MiniMapHooks {
    /** Presses `h`: shows the minimap for its 2.2 s peek, exactly as the
     * key does in flight. */
    press(): void;
    /** Whether a peek is running (on screen, unless something modal is). */
    readonly shown: boolean;
    /** Whether it takes pointer input right now: only while shown, in
     * flight with nothing modal up — never while hidden or fading out. */
    readonly takesInput: boolean;
    /** The graph it shows (to click systems on), once built. */
    graph(): SystemGraph | undefined;
}

/**
 * Opens the starmap over whatever is on screen and resolves with the
 * chosen route when it closes. Landed menus (the spaceport) call this
 * for their 'map' key — the Mission BBS passes the viewed mission's
 * destination marks and the player's date through the options; in
 * flight the plugin's own subscription below opens it. No-ops
 * (resolving with the current route) while the map is already open.
 */
export const OpenStarmapResource =
    new Resource<(options?: OpenStarmapOptions) => Promise<string[]>>(
        'OpenStarmap');

/**
 * The map's client-side route state (pinned multi-jump waypoints and the
 * single-jump pick). Module-level so it survives world rebuilds (system
 * transits): the display world is torn down at every jump, but pinned
 * waypoints must persist until the player reaches or unpins them. Per-player
 * by construction (it lives in this client's page). Only the derived
 * effective route — plain adjacent hops — ever reaches the simulation, via
 * the SetJumpRouteEvent -> setPlayerJumpRoute input-record path.
 */
const persistentRouteStore: RouteStateStore = { state: emptyRouteState() };

/**
 * When the `h` minimap's current peek ends (spaceport/mini_map.ts), on the
 * display clock — epoch-based wall time, so it carries over a display-world
 * rebuild. Module-level for the same reason as {@link persistentRouteStore}:
 * a peek still running when the world is rebuilt for the next system runs
 * its remainder there rather than being cut off. Whether the original
 * shows the minimap by itself during a jump (the reference capture
 * mini_map.png has it up with "Jumping into the Tau Ceti system" on screen)
 * is untested, so nothing here shows it for one.
 */
const miniMapPeek: MiniMapPeek = { until: -Infinity };

/** The in-flight minimap's per-world state, refreshed every frame. */
interface MiniMapState {
    miniMap: MiniMap;
    /** Re-derives visibility and position (see DrawMiniMap). */
    update(): void;
}
const MiniMapResource = new Resource<MiniMapState>('MiniMap');

/**
 * Keeps the minimap's visibility and place current: usable (drawn and
 * clickable during a peek, then neither) only while it has a map to show
 * and nothing modal is up — a landed screen, or the full map in flight, owns
 * the screen (and the keyboard) then; and anchored beside the status bar
 * at whatever size the window is.
 */
const DrawMiniMap = new System({
    name: 'DrawMiniMap',
    args: [MiniMapResource, SingletonComponent] as const,
    step(state) {
        state.update();
    },
});

/**
 * A component of the player's ship: the in-world PlayerShipSelector
 * entity in flight, or — while DOCKED — the docked player's data as it
 * stands right now (DockedShipResource's `component`, the same handle
 * the status bar reads). Landing removes the ship from the simulation
 * and hence from this display world, so a scan of `world.entities` alone
 * comes up empty for the whole visit; the docked map was therefore
 * filtered against an EMPTY control-bit set — every bXXX-gated system
 * gone, every !bXXX stacked duplicate back, no Legal Status line (review
 * finding #29). And it must be the landing's WORKING copy, not the held
 * hull: the hull is only written when a venue closes, so a map opened
 * from the BBS right after an accept read the bits, records and missions
 * of before the BBS opened (#324).
 */
export function playerComponent<T>(world: World,
    component: Component<T>): T | undefined {
    for (const entity of world.entities.values()) {
        if (!entity.components.has(PlayerShipSelector)) {
            continue;
        }
        const value = entity.components.get(component);
        if (value !== undefined) {
            return value;
        }
    }
    return world.resources.get(DockedShipResource)?.current
        ?.component(component);
}

/**
 * The player's active-mission map marks (the original's orange arrows),
 * resolved against the player's REAL control bits so a destination in an
 * NCB-stacked duplicate system marks the copy the player can see (review
 * finding #65: without bits, systemIdOfPlanet picks the id-sorted first
 * copy — the pre-story one — which the graph then filters out, so the
 * arrow for exactly the storyline missions that unlock new copies was
 * never drawn in flight).
 */
export function playerMissionMarks(world: World,
    universe: MissionUniverse): MissionMapMark[] {
    const missions = playerComponent(world, MissionsComponent);
    if (!missions) {
        return [];
    }
    const bits = playerComponent(world, ControlBitsComponent) ?? new Set();
    return missionMapMarks(missions.values(),
        id => universe.getMission(id),
        planetId => universe.systemIdOfPlanet(planetId, bits));
}

export const StarmapPlugin: Plugin = {
    name: 'StarmapPlugin',
    build(world) {
        const simulationData = world.resources.get(SimulationGameDataResource);
        if (!simulationData) {
            throw new Error('Expected SimulationGameDataResource to exist');
        }
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        if (!displayAssets) {
            throw new Error('Expected DisplayAssetDataResource to exist');
        }
        const controls = world.resources.get(ControlsSubject);
        if (!controls) {
            throw new Error('Expected ControlsSubject to exist');
        }
        const stage = world.resources.get(Stage);
        if (!stage) {
            throw new Error('Expected Stage to exist');
        }
        const systemId = world.resources.get(SystemIdResource);
        if (!systemId) {
            throw new Error('Expected SystemIdResource to exist');
        }
        const screenSize = world.resources.get(ScreenSize);
        if (!screenSize) {
            throw new Error('Expected ScreenSize to exist');
        }
        const discovery = world.resources.get(DiscoveryStoreResource);
        if (!discovery) {
            throw new Error('Expected DiscoveryStoreResource to exist');
        }

        // Being here discovers this system: a display world only exists for
        // the system the player is in (including the starting one). Level 1
        // — you see what is inhabited, not what the ports sell; landing is
        // what raises it to 2 (browser.ts, discovery.ts).
        discovery.mark(systemId, DISCOVERY_ENTERED);

        // NCB system visibility uses the player's real control bits.
        const getPlayerBits = (): ReadonlySet<number> =>
            playerComponent(world, ControlBitsComponent) ?? new Set();

        // Active-mission destination marks (the original's orange arrows),
        // derived from the player's missions against the shared
        // stellar->system index. Universe load is idempotent and shared.
        const universe = MissionUniverse.shared(simulationData);
        void universe.load();

        // A map outfit still ABOARD on arrival maps the area around the
        // system just entered. In the stock data the only way to be
        // carrying one is a set string that granted it — the Vell-os Area
        // Map ability (crön nova:381 -> oütf nova:342) — because buying a
        // map consumes it in the outfitter. See spaceport/map_outfit.ts.
        void universe.load().then(async () => {
            const outfits = playerComponent(world, OutfitsStateComponent);
            if (!outfits) {
                return;
            }
            const mapOutfits = new Map<string, OutfitData>();
            for (const [id, { count }] of outfits) {
                if (count <= 0) {
                    continue;
                }
                try {
                    const outfit = await simulationData.data.Outfit.get(id);
                    if (outfit.map !== null) {
                        mapOutfits.set(id, outfit);
                    }
                } catch {
                    // An id this data set doesn't have: nothing to apply.
                }
            }
            applyOwnedMapOutfits(mapOutfits.keys(), systemId, universe,
                id => mapOutfits.get(id), discovery);
        }).catch(e => console.warn('Failed to apply map outfits:', e));
        const getMissionMarks = () => playerMissionMarks(world, universe);

        const starmap = new Starmap(displayAssets, simulationData, systemId,
            controls, getPlayerBits, getMissionMarks, persistentRouteStore,
            id => discovery.level(id),
            () => playerComponent(world, GameDateComponent),
            () => playerComponent(world, LegalRecordsComponent),
            // The red dot's landing-clearance inputs: the components the
            // landing gate reads, through the same docked-aware lookup.
            // Bribe expiries are SIM-clock stamps, so the clock is the
            // simulation's, not this world's wall-clock TimeResource.
            () => ({
                records: playerComponent(world, LegalRecordsComponent),
                shipData: playerComponent(world, ShipDataComponent),
                outfits: playerComponent(world, OutfitsStateComponent),
                bribes: playerComponent(world, StellarBribesComponent),
                ranks: playerComponent(world, ActiveRanksComponent),
                missions: playerComponent(world, MissionsComponent),
                now: world.resources.get(SimulationTimeResource)?.time ?? 0,
            }));
        let opening = false;
        // Set by remove(): a map dismissed because its world is being torn
        // down (jump/gate transit with the map open) must not write its
        // stale route back into the next system's state.
        let disposed = false;
        stage.addChild(starmap.container);
        // Centred on the live UI size, and kept there through resizes
        // while open (CentredUiResource).
        keepCentred(world, starmap.container);
        world.resources.set(StarmapResource, starmap);
        // Debug/headless-driving handle, like window.displayWorld.
        if (typeof window !== 'undefined') {
            window.novaStarmap = starmap;
            // The discovery record, for the visual-comparison harness and
            // for debugging: there is no in-game way to hand a pilot a
            // galaxy, and the map's chrome scenarios need one to compare
            // against the reference captures' mid-game pilot.
            const discoveryHooks: DiscoveryHooks = {
                level: (id: string) => discovery.level(id),
                mark: (ids: string[], level: DiscoveryLevel) =>
                    discovery.markMany(ids, level),
                markAll: async (level: DiscoveryLevel = DISCOVERY_LANDED) => {
                    const ids = (await simulationData.ids).System;
                    discovery.markMany(ids, level);
                },
            };
            window.novaDiscovery = discoveryHooks;
        }
        const openStarmap = async (
            options?: OpenStarmapOptions): Promise<string[]> => {
            const jumpRoute = playerJumpRoute(world);
            if (starmap.container.visible || opening) {
                return jumpRoute?.route ?? [];
            }
            opening = true;
            try {
                // Re-adding moves the map to the top of the stage: the
                // spaceport's container is added after the starmap's,
                // so a docked map would otherwise open underneath it.
                stage.addChild(starmap.container);
                starmap.openOptions = options ?? {};
                const route = await starmap.show(jumpRoute?.route ?? []);
                if (disposed) {
                    return route;
                }
                commitRoute(route);
                // The full map may have changed the route the minimap shows.
                void refreshMiniMap();
                return route;
            } finally {
                opening = false;
            }
        };
        /**
         * Hands a route the player plotted (the full map's Done, or a pick
         * on the minimap) to the simulation: mirrored onto the local
         * JumpRouteComponent for immediate display and sent as a
         * SetJumpRouteEvent -> setPlayerJumpRoute input record, which is
         * what every peer actually simulates. `route` is edited in place
         * (see below), so the caller sees what was committed.
         */
        const commitRoute = (route: string[]) => {
            // A JUMP ALREADY IN PROGRESS has consumed its destination off
            // the route (beginJump shifts it at jump start), but the map
            // re-derives the route from the system the ship is still in, so
            // that hop is back at the head. Written back as-is, the ship
            // would arrive and immediately jump out of and back into the
            // system it just reached (Matthew's playtest, 2026-08-17). The
            // simulation drops such a head on arrival regardless
            // (JumpRouteReconcileSystem); this keeps the route the player
            // and their peers see correct in the meantime.
            const committed = playerComponent(world, JumpComponent)?.to;
            if (committed && route[0] === committed) {
                route.shift();
            }
            const jumpRoute = playerJumpRoute(world);
            if (jumpRoute) {
                jumpRoute.route = route;
            }
            world.emit(SetJumpRouteEvent, { route });
        };

        // The `h` hyperspace minimap (spaceport/mini_map.ts). Built as soon
        // as the player is here, not on the first `h`, so the first press
        // shows a map at once.
        const miniMap = new MiniMap(
            () => world.resources.get(TimeResource)?.time ?? 0, miniMapPeek);
        stage.addChild(miniMap.container);
        /** Rebuilds the minimap's graph from the galaxy and route as they
         * stand now. Cheap enough per `h`: only the drawn systems. */
        let miniMapBuild = 0;
        const refreshMiniMap = async () => {
            const build = ++miniMapBuild;
            let graph;
            try {
                graph = await starmap.miniMapGraph(MINI_MAP_PANE,
                    MINI_MAP_ZOOM, playerJumpRoute(world)?.route ?? []);
            } catch (e) {
                console.warn('Minimap failed to build:', e);
                return;
            }
            // Superseded or torn down while the data loaded.
            if (disposed || build !== miniMapBuild) {
                graph?.container.destroy({ children: true });
                return;
            }
            miniMap.setGraph(graph);
        };
        miniMap.picked.subscribe(graph => {
            persistentRouteStore.state = graph.getRouteState();
            commitRoute(graph.getEffectiveRoute());
        });
        /** `h`: a 2.2 s peek, over a map rebuilt so it shows the mission
         * marks and discoveries of right now. */
        const pressMiniMap = () => {
            miniMap.peek();
            void refreshMiniMap();
        };
        // Not before the player's ship has reached the display world: a
        // graph filtered against no control bits would show the wrong NCB
        // copies, and building one reconciles the persisted route against
        // its links (Starmap.miniMapGraph), which could drop a pick that
        // only the player's real bits make adjacent.
        let builtForPlayer = false;
        world.resources.set(MiniMapResource, {
            miniMap,
            update() {
                if (!builtForPlayer
                    && playerComponent(world, ControlBitsComponent)) {
                    builtForPlayer = true;
                    void refreshMiniMap();
                }
                const docked = world.resources.get(DockedShipResource)
                    ?.current !== undefined;
                const active = MenuControls.focused === undefined && !docked;
                miniMap.update(active);
                // Placed whenever it may be used, hidden or not, so it is
                // already in place on the frame a peek starts.
                if (!active) {
                    return;
                }
                const statusBar = world.resources.get(StatusBarResource);
                const { x, y } = miniMapPosition(screenSize,
                    statusBar?.container.width ?? 0);
                miniMap.container.position.set(x, y);
            },
        });
        world.addSystem(DrawMiniMap);
        // Debug/headless-driving handle (window_hooks.ts).
        if (typeof window !== 'undefined') {
            window.novaMiniMap = {
                press: pressMiniMap,
                get shown() {
                    return miniMap.showing;
                },
                get takesInput() {
                    return miniMap.takesInput;
                },
                graph: () => miniMap.current,
            };
        }
        world.resources.set(OpenStarmapResource, openStarmap);
        world.resources.set(StarmapDisposer, () => { disposed = true; });
        world.resources.set(StarmapControlsSubscription, controls.subscribe(({ action, state }) => {
            if (action === 'smallMap' && state === 'start') {
                // In flight only, like 'm': a landed menu, or the full
                // map, owns the keyboard (and in the bar, `h` is Hire).
                if (MenuControls.focused
                    || world.resources.get(DockedShipResource)?.current) {
                    return;
                }
                pressMiniMap();
                return;
            }
            if (action !== 'map' || state !== 'start') {
                return;
            }
            // While a landed menu owns the keyboard, 'm' belongs to
            // that menu (the spaceport opens the map itself; deeper
            // screens reserve the key but don't act on it).
            if (MenuControls.focused) {
                return;
            }
            // This branch runs only in space (no menu focused), so the
            // map-open/close beeps here are the in-space cues only — a
            // docked map (opened by the spaceport) never reaches here.
            // Once the map is open it binds its own MenuControls, so a
            // second 'm' is handled there (and re-blocked above), leaving
            // this as a clean single open per in-space press.
            playUiSound(world, { id: BEEP_MAP_OPEN });
            void openStarmap().then(
                () => playUiSound(world, { id: BEEP_MAP_CLOSE }));
        }));
    },
    remove(world) {
        world.resources.get(StarmapControlsSubscription)?.unsubscribe();
        world.removeSystem(DrawMiniMap);
        const miniMapState = world.resources.get(MiniMapResource);
        if (miniMapState) {
            world.resources.get(Stage)?.removeChild(miniMapState.miniMap.container);
            miniMapState.miniMap.destroy();
        }
        world.resources.delete(MiniMapResource);
        const stage = world.resources.get(Stage);
        const starmap = world.resources.get(StarmapResource);
        // A map still open while its world dies (jumped with 'm' up) would
        // otherwise keep its MenuControls bound forever, and the ship could
        // not be flown in the next system.
        world.resources.get(StarmapDisposer)?.();
        starmap?.dismiss();
        if (starmap) {
            stopCentring(world, starmap.container);
        }
        if (stage && starmap) {
            stage.removeChild(starmap.container);
        }
        // Destroyed, children included: the map is per-world, and its
        // system-name Texts and link/route Graphics leaked with every
        // transit (review #40). Sprite textures (cicn marks, PICT frame)
        // are the asset cache's and are left alone.
        starmap?.container.destroy({ children: true });
        world.resources.delete(StarmapControlsSubscription);
        world.resources.delete(StarmapDisposer);
        world.resources.delete(StarmapResource);
        world.resources.delete(OpenStarmapResource);
    }
}

/**
 * The player's jump route: the in-world ship's in flight, the docked
 * player's while landed (#323) — through {@link playerComponent} like
 * every other player read, so the docked map reconciles against the
 * route the ship really holds, and its close edits the route the
 * landing's transaction writes onto the hull for the lift-off. (The
 * SetJumpRouteEvent the close also emits is dropped by the simulation
 * while docked, there being no ship there to apply it to; the lift-off's
 * insertion record is what carries the route in.)
 */
export function playerJumpRoute(world: World) {
    return playerComponent(world, JumpRouteComponent);
}
