import { Emit } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { ControlsSubject } from '../nova_plugin/controls_plugin.js';
import { discoveryLevel } from '../nova_plugin/discovery_store.js';
import { DisplayAssetDataResource, SimulationGameDataResource } from '../nova_plugin/game_data_resource.js';
import { MissionMapMark, missionMapMarks } from '../nova_plugin/mission_logic.js';
import { MissionsComponent } from '../nova_plugin/player_state_plugin.js';
import { GateMap } from '../spaceport/gate_map.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import {
    ResizeEvent, ScreenSize, screenCentre,
} from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';

/**
 * The hypergate map UI (display-side, player-local — like the spaceport).
 * The browser docks the ship on a hypergate landing (removing it from the
 * sim through the same machinery as a spaceport dock) and emits
 * OpenGateMapEvent; the map resolves with the picked neighbor gate (or null
 * for "lift back off") via LeaveGateMapEvent, which the browser turns into a
 * jumpTo room switch or a relaunch.
 */
export const OpenGateMapEvent = new EcsEvent<{
    gateSpob: string,
    systemId: string,
    ship: Entity,
}>('OpenGateMapEvent');

export const LeaveGateMapEvent = new EcsEvent<{
    ship: Entity,
    destinationSpob: string | null,
}>('LeaveGateMapEvent');

const GateMapResource = new Resource<GateMap>('GateMapResource');
/** The shared stellar/mission index, for the map's mission marks. */
const GateMapUniverseResource =
    new Resource<MissionUniverse>('GateMapUniverseResource');

/**
 * The player's active-mission marks for the DOCKED ship. The gate map only
 * ever opens for a ship the browser has just pulled out of the world, so
 * the marks have to come off that entity — the same reason the spaceport
 * passes its own marks to the starmap (OpenStarmapOptions.missionMarks).
 */
export function gateMapMissionMarks(ship: Entity,
    universe: MissionUniverse): MissionMapMark[] {
    const missions = ship.components.get(MissionsComponent);
    if (!missions) {
        return [];
    }
    return missionMapMarks(missions.values(),
        id => universe.getMission(id),
        planetId => universe.systemIdOfPlanet(planetId));
}

const OpenGateMapSystem = new System({
    name: 'OpenGateMapSystem',
    events: [OpenGateMapEvent],
    args: [OpenGateMapEvent, GateMapResource, GateMapUniverseResource,
        ScreenSize, Emit, SingletonComponent] as const,
    step({ gateSpob, systemId, ship }, gateMap, universe, screen, emit) {
        const centre = screenCentre(screen);
        gateMap.container.position.x = centre.x;
        gateMap.container.position.y = centre.y;
        void gateMap.show({
            gateSpob, systemId, destinationSpob: null,
            missionMarks: gateMapMissionMarks(ship, universe),
        }).then(({ destinationSpob }) =>
            emit(LeaveGateMapEvent, { ship, destinationSpob }));
    }
});

const GateMapResizeSystem = new System({
    name: 'GateMapResize',
    events: [ResizeEvent],
    args: [ResizeEvent, GateMapResource, SingletonComponent] as const,
    step(resize, gateMap) {
        const centre = screenCentre(resize);
        gateMap.container.position.x = centre.x;
        gateMap.container.position.y = centre.y;
    }
});

export const GateMapPlugin: Plugin = {
    name: 'GateMapPlugin',
    build(world) {
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        const simulationData = world.resources.get(SimulationGameDataResource);
        const controls = world.resources.get(ControlsSubject);
        const stage = world.resources.get(Stage);
        if (!displayAssets || !simulationData || !controls || !stage) {
            throw new Error('Expected display assets, game data, controls, '
                + 'and stage resources for the gate map');
        }
        const gateMap = new GateMap(displayAssets, simulationData, controls,
            id => discoveryLevel(id));
        stage.addChild(gateMap.container);
        world.resources.set(GateMapResource, gateMap);
        // Idempotent and shared with the starmap / mission board; kicked
        // off here so the stellar->system index is warm by the time the
        // player reaches a gate.
        const universe = MissionUniverse.shared(simulationData);
        void universe.load();
        world.resources.set(GateMapUniverseResource, universe);
        world.addSystem(OpenGateMapSystem);
        world.addSystem(GateMapResizeSystem);
    },
    remove(world) {
        const gateMap = world.resources.get(GateMapResource);
        if (gateMap) {
            // Destroyed, children included: the map is per-world, and its
            // Texts and Graphics leaked with every transit (review #40).
            // Sprite textures are the asset cache's and are left alone.
            // (Not dismissed like the starmap: its result drives a
            // relaunch/jump in browser.ts, which a teardown must not fire.)
            gateMap.container.destroy({ children: true });
        }
        world.removeSystem(OpenGateMapSystem);
        world.removeSystem(GateMapResizeSystem);
        world.resources.delete(GateMapResource);
        world.resources.delete(GateMapUniverseResource);
    }
}
