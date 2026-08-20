import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { World } from 'nova_ecs/world';
import { EcsEvent } from 'nova_ecs/events';
import { Subscription } from 'rxjs';
import { Component } from 'nova_ecs/component';
import { OutfitData } from 'novadatainterface/outfit_data';
import { DisplayAssetDataResource, SimulationGameDataResource } from '../nova_plugin/game_data_resource.js';
import { ControlsSubject } from '../nova_plugin/controls_plugin.js';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DiscoveryLevel,
} from '../nova_plugin/discovery.js';
import {
    discoveryLevel, markDiscovered, markManyDiscovered,
} from '../nova_plugin/discovery_store.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { applyOwnedMapOutfits } from '../spaceport/map_outfit.js';
import { JumpComponent, JumpRouteComponent } from '../nova_plugin/jump_plugin.js';
import { missionMapMarks } from '../nova_plugin/mission_logic.js';
import { ControlBitsComponent } from '../nova_plugin/ncb_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { GameDateComponent, MissionsComponent } from '../nova_plugin/player_state_plugin.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation_plugin.js';
import { SystemIdResource } from '../nova_plugin/system_id_resource.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { emptyRouteState } from '../spaceport/route.js';
import { OpenStarmapOptions, RouteStateStore, Starmap } from '../spaceport/starmap.js';
import { ScreenSize } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { BEEP_MAP_CLOSE, BEEP_MAP_OPEN, playUiSound } from './ui_sound.js';

const StarmapResource = new Resource<Starmap>("Starmap");
const StarmapControlsSubscription = new Resource<Subscription>('StarmapControlsSubscription');
/** Marks the plugin's openStarmap as torn down (see remove). */
const StarmapDisposer = new Resource<() => void>('StarmapDisposer');
export const SetJumpRouteEvent = new EcsEvent<{ route: string[] }>('SetJumpRouteEvent');
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

function playerComponent<T>(world: World,
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
    return undefined;
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

        // Being here discovers this system: a display world only exists for
        // the system the player is in (including the starting one). Level 1
        // — you see what is inhabited, not what the ports sell; landing is
        // what raises it to 2 (browser.ts, discovery.ts).
        markDiscovered(systemId, DISCOVERY_ENTERED);

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
                id => mapOutfits.get(id));
        }).catch(e => console.warn('Failed to apply map outfits:', e));
        const getMissionMarks = () => {
            const missions = playerComponent(world, MissionsComponent);
            if (!missions) {
                return [];
            }
            return missionMapMarks(missions.values(),
                id => universe.getMission(id),
                planetId => universe.systemIdOfPlanet(planetId));
        };

        const starmap = new Starmap(displayAssets, simulationData, systemId,
            controls, getPlayerBits, getMissionMarks, persistentRouteStore,
            id => discoveryLevel(id),
            () => playerComponent(world, GameDateComponent),
            () => playerComponent(world, LegalRecordsComponent));
        let opening = false;
        // Set by remove(): a map dismissed because its world is being torn
        // down (jump/gate transit with the map open) must not write its
        // stale route back into the next system's state.
        let disposed = false;
        stage.addChild(starmap.container);
        world.resources.set(StarmapResource, starmap);
        // Debug/headless-driving handle, like window.displayWorld.
        if (typeof window !== 'undefined') {
            (window as unknown as { novaStarmap: Starmap }).novaStarmap =
                starmap;
            // The discovery record, for the visual-comparison harness and
            // for debugging: there is no in-game way to hand a pilot a
            // galaxy, and the map's chrome scenarios need one to compare
            // against the reference captures' mid-game pilot.
            (window as unknown as { novaDiscovery: unknown }).novaDiscovery = {
                level: (id: string) => discoveryLevel(id),
                mark: (ids: string[], level: DiscoveryLevel) =>
                    markManyDiscovered(ids, level),
                markAll: async (level: DiscoveryLevel = DISCOVERY_LANDED) => {
                    const ids = (await simulationData.ids).System;
                    markManyDiscovered(ids, level);
                },
            };
        }
        const openStarmap = async (
            options?: OpenStarmapOptions): Promise<string[]> => {
            const jumpRoute = getPlayerJumpRoute(world);
            if (starmap.container.visible || opening) {
                return jumpRoute?.route ?? [];
            }
            opening = true;
            try {
                // Re-adding moves the map to the top of the stage: the
                // spaceport's container is added after the starmap's,
                // so a docked map would otherwise open underneath it.
                stage.addChild(starmap.container);
                starmap.container.position.set(screenSize.x / 2, screenSize.y / 2);
                starmap.openOptions = options ?? {};
                const route = await starmap.show(jumpRoute?.route ?? []);
                if (disposed) {
                    return route;
                }
                // A JUMP ALREADY IN PROGRESS has consumed its destination
                // off the route (beginJump shifts it at jump start), but
                // the map re-derives the route from the system the ship is
                // still in, so that hop is back at the head. Written back
                // as-is, the ship would arrive and immediately jump out of
                // and back into the system it just reached (Matthew's
                // playtest, 2026-08-17). The simulation drops such a head
                // on arrival regardless (JumpRouteReconcileSystem); this
                // keeps the route the player and their peers see correct
                // in the meantime.
                const committed = playerComponent(world, JumpComponent)?.to;
                if (committed && route[0] === committed) {
                    route.shift();
                }
                if (jumpRoute) {
                    jumpRoute.route = route;
                }
                world.emit(SetJumpRouteEvent, { route });
                return route;
            } finally {
                opening = false;
            }
        };
        world.resources.set(OpenStarmapResource, openStarmap);
        world.resources.set(StarmapDisposer, () => { disposed = true; });
        world.resources.set(StarmapControlsSubscription, controls.subscribe(({ action, state }) => {
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
        const stage = world.resources.get(Stage);
        const starmap = world.resources.get(StarmapResource);
        // A map still open while its world dies (jumped with 'm' up) would
        // otherwise keep its MenuControls bound forever, and the ship could
        // not be flown in the next system.
        world.resources.get(StarmapDisposer)?.();
        starmap?.dismiss();
        if (stage && starmap) {
            stage.removeChild(starmap.container);
        }
        world.resources.delete(StarmapControlsSubscription);
        world.resources.delete(StarmapDisposer);
        world.resources.delete(StarmapResource);
        world.resources.delete(OpenStarmapResource);
    }
}

function getPlayerJumpRoute(world: World) {
    for (const entity of world.entities.values()) {
        if (!entity.components.has(PlayerShipSelector)) {
            continue;
        }
        const jumpRoute = entity.components.get(JumpRouteComponent);
        if (jumpRoute) {
            return jumpRoute;
        }
    }
    return undefined;
}
