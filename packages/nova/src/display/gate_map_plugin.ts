import { Emit, GetWorld } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { SingletonComponent } from 'nova_ecs/world';
import {
    ControlsSubject, DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/core/index.js';
import { DiscoveryStoreResource, DominatedComponent, MissionsComponent } from '../nova_plugin/player/index.js';
import { MissionMapMark, missionMapMarks } from '../nova_plugin/missions/index.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import {
    OutfitsStateComponent, ShipDataComponent,
} from '../nova_plugin/ship/index.js';
import { StellarBribesComponent } from '../nova_plugin/travel/index.js';
import { GateMap } from '../spaceport/gate_map.js';
import { MapClearancePlayer } from '../spaceport/starmap.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import {
    ResizeEvent, ScreenSize, screenCentre,
} from './screen_size_plugin.js';
import { closeFlightOverlays } from './flight_overlays.js';
import { SimulationTimeResource } from './simulation_time.js';
import { Stage } from './stage_resource.js';
import { HYPERGATE_JUMP_CANCELLED_MESSAGE } from './status_bar_content.js';
import { StatusLineResource } from './status_message_plugin.js';

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
/** The SIMULATION clock (the mirrored SimulationTimeResource, 0 before
 * the first frame): bribe expiries are sim-clock stamps, as in
 * starmap_plugin. */
const GateMapSimClock = new Resource<() => number>('GateMapSimClock');
/** The shared stellar/mission index, for the map's mission marks. */
const GateMapUniverseResource =
    new Resource<MissionUniverse>('GateMapUniverseResource');

/**
 * The player's active-mission marks for the DOCKED ship. The gate map only
 * ever opens for a ship the browser has just pulled out of the world, so
 * the marks have to come off that entity — the same reason the spaceport
 * passes its own marks to the starmap (OpenStarmapOptions.missionMarks).
 *
 * Resolved with the ship's control bits: a destination stellar stacked in
 * NCB-duplicate systems (Auroran LP I in nova:308 "!b995" / nova:765
 * "b995") must mark the copy the player can SEE, or the mark lands in the
 * hidden copy and is never drawn (review finding #65).
 */
export function gateMapMissionMarks(ship: Entity,
    universe: MissionUniverse): MissionMapMark[] {
    const missions = ship.components.get(MissionsComponent);
    if (!missions) {
        return [];
    }
    const bits = ship.components.get(ControlBitsComponent) ?? new Set();
    return missionMapMarks(missions.values(),
        id => universe.getMission(id),
        planetId => universe.systemIdOfPlanet(planetId, bits));
}

/**
 * The DOCKED ship's landing-clearance inputs, for the gate map's orange /
 * red dots: the components the star map reads through starmap_plugin's
 * playerComponent, off the entity because it is out of the world, and the
 * SIMULATION clock that bribe expiries are stamped on.
 */
export function gateMapClearancePlayer(ship: Entity, now: number)
    : MapClearancePlayer {
    const c = ship.components;
    return {
        records: c.get(LegalRecordsComponent),
        shipData: c.get(ShipDataComponent),
        outfits: c.get(OutfitsStateComponent),
        bribes: c.get(StellarBribesComponent),
        ranks: c.get(ActiveRanksComponent),
        missions: c.get(MissionsComponent),
        dominated: c.get(DominatedComponent),
        now,
    };
}

const OpenGateMapSystem = new System({
    name: 'OpenGateMapSystem',
    events: [OpenGateMapEvent],
    args: [OpenGateMapEvent, GateMapResource, GateMapUniverseResource,
        GateMapSimClock, ScreenSize, Emit, GetWorld,
        SingletonComponent] as const,
    step({ gateSpob, systemId, ship }, gateMap, universe, simClock, screen,
        emit, world) {
        // Docking at the gate closes what was open over space, as a
        // spaceport landing does (display/flight_overlays.ts).
        closeFlightOverlays(world);
        const now = simClock();
        const centre = screenCentre(screen);
        gateMap.container.position.x = centre.x;
        gateMap.container.position.y = centre.y;
        void gateMap.show({
            gateSpob, systemId, destinationSpob: null,
            missionMarks: gateMapMissionMarks(ship, universe),
            // The docked ship is out of the world, so its bits come off
            // the entity too: they decide which systems (and gates) exist.
            playerBits: ship.components.get(ControlBitsComponent)
                ?? new Set<number>(),
            // And its records, for the column's Legal Status line.
            legalRecords: ship.components.get(LegalRecordsComponent),
            // And what the dots' landing-clearance colours read: the gate
            // map's dots are the star map's (orange / red included).
            clearancePlayer: gateMapClearancePlayer(ship, now),
        }).then(({ destinationSpob }) =>
            emit(LeaveGateMapEvent, { ship, destinationSpob }));
    }
});

/**
 * Done with no pick: the status line says "Hypergate jump cancelled." (STR#
 * 2002 one-based 50, reference "Wave-24 leftovers, wave 25") as the ship
 * lifts back off at the gate. No PlayerShipSelector: the docked ship is out
 * of the world until the relaunch, and the gate map is the local player's.
 */
export const GateMapCancelledSystem: System = new System({
    name: 'GateMapCancelled',
    events: [LeaveGateMapEvent],
    args: [LeaveGateMapEvent, StatusLineResource, TimeResource,
        SingletonComponent] as const,
    step({ destinationSpob }, statusLine, { time }) {
        if (destinationSpob === null) {
            statusLine.setMessage(HYPERGATE_JUMP_CANCELLED_MESSAGE, time);
        }
    },
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
        const discovery = world.resources.get(DiscoveryStoreResource);
        if (!displayAssets || !simulationData || !controls || !stage
            || !discovery) {
            throw new Error('Expected display assets, game data, controls, '
                + 'stage, and discovery store resources for the gate map');
        }
        const gateMap = new GateMap(displayAssets, simulationData, controls,
            id => discovery.level(id));
        stage.addChild(gateMap.container);
        world.resources.set(GateMapResource, gateMap);
        // Debug/headless-driving handle, like window.novaStarmap.
        if (typeof window !== 'undefined') {
            window.novaGateMap = gateMap;
        }
        // Idempotent and shared with the starmap / mission board; kicked
        // off here so the stellar->system index is warm by the time the
        // player reaches a gate.
        const universe = MissionUniverse.shared(simulationData);
        void universe.load();
        world.resources.set(GateMapUniverseResource, universe);
        world.resources.set(GateMapSimClock,
            () => world.resources.get(SimulationTimeResource)?.time ?? 0);
        world.addSystem(OpenGateMapSystem);
        world.addSystem(GateMapResizeSystem);
        world.addSystem(GateMapCancelledSystem);
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
        world.removeSystem(GateMapCancelledSystem);
        world.resources.delete(GateMapResource);
        world.resources.delete(GateMapUniverseResource);
        world.resources.delete(GateMapSimClock);
    }
}
