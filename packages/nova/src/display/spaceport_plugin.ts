import { Emit, Entities, RunQuery } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { Provide } from 'nova_ecs/provide';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { EcsEvent } from 'nova_ecs/events';
import { SingletonComponent } from 'nova_ecs/world';
import { ControlsSubject } from '../nova_plugin/controls_plugin.js';
import { DisplayAssetDataResource, SimulationGameDataResource } from '../nova_plugin/game_data_resource.js';
import { PlanetComponent, PlanetDataComponent } from '../nova_plugin/planet_plugin.js';
import {
    countDeployedFighters, countLandedFighters, mergeDeployedCounts,
} from '../spaceport/deployed_outfits.js';
import { Spaceport } from '../spaceport/spaceport.js';
import { DockedShip, DockedShipResource } from './docked_ship.js';
import { OpenMissionInfoResource } from './mission_info_plugin.js';
import { OpenPlayerInfoResource } from './player_info_plugin.js';
import { ResizeEvent, ScreenSize } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { OpenStarmapResource } from './starmap_plugin.js';
import { UiSoundEvent } from './ui_sound.js';


const SpaceportComponent = new Component<Spaceport>("Spaceport");

const SpaceportProvider = Provide({
    name: "SpaceportProvider",
    provided: SpaceportComponent,
    args: [DisplayAssetDataResource, SimulationGameDataResource, ControlsSubject, Stage, OpenStarmapResource, OpenPlayerInfoResource, OpenMissionInfoResource, PlanetComponent] as const,
    factory(displayAssets, simulationData, controls, stage, openStarmap, openPlayerInfo, openMissionInfo, { id }) {
        const spaceport = new Spaceport(displayAssets, simulationData, id, controls, openStarmap, openPlayerInfo, openMissionInfo);
        stage.addChild(spaceport.container);
        return spaceport;
    }
});

const SpaceportQuery = new Query([SpaceportComponent, PlanetComponent] as const);

/**
 * `uuid` is the docked ship's uuid in the display world. It is optional
 * because the ship is REMOVED from that world before this fires, so
 * nothing can look it up afterwards — but entities it launched (bay
 * fighters) still reference it, which is how the outfitter counts
 * fighters that are still deployed. Omitted, the outfitter simply
 * assumes everything the player owns is aboard.
 *
 * `landedEscorts` is a live getter for the client's landed-escort roster
 * (browser.ts / spaceport/landed_escorts.ts): bay fighters that LANDED
 * with the player are out of the display world but still deployed, so
 * the outfitter must count them too. A getter because escorts keep
 * touching down while the player shops.
 */
export const OpenSpaceportEvent = new EcsEvent<{
    planetId: string, ship: Entity, uuid?: string,
    landedEscorts?: () => readonly { player: string, entity: Entity }[],
}>('OpenSpaceportEvent');
export const LeaveSpaceportEvent = new EcsEvent<Entity>('LeaveSpaceportEvent');

const OpenSpaceportSystem = new System({
    name: 'OpenSpaceportSystem',
    events: [OpenSpaceportEvent],
    args: [OpenSpaceportEvent, RunQuery, ScreenSize, Emit,
        DockedShipResource, Entities, SimulationGameDataResource,
        SingletonComponent] as const,
    step({ planetId, ship, uuid, landedEscorts }, runQuery, { x, y }, emit,
        dockedHolder, entities, gameData) {
        const spaceport = runQuery(SpaceportQuery)
            .find(([, { id }]) => id === planetId)?.[0];
        if (!spaceport) {
            return;
        }

        // Owned-but-not-aboard outfits for this landing: fighters still
        // in FLIGHT (a closure over the live EntityMap — one shot down
        // mid-visit stops counting) plus fighters that LANDED with the
        // player (the roster getter — one that touches down mid-visit
        // moves from the first count to the second, total unchanged).
        const getOutfit =
            (id: string) => gameData.data.Outfit.getCached(id);
        spaceport.setDeployedOutfitCounts(uuid === undefined ? undefined
            : mergeDeployedCounts(
                countDeployedFighters(entities, uuid, getOutfit),
                ...landedEscorts === undefined ? []
                    : [countLandedFighters(landedEscorts, uuid, getOutfit)]));

        // Publish the held ship so the status bar (out-of-world while docked)
        // keeps drawing its credits/fuel/cargo, and let the spaceport push
        // each venue's live working state through it per-transaction.
        const dockedShip = new DockedShip(ship);
        dockedHolder.current = dockedShip;
        spaceport.setDockedShip(dockedShip);

        spaceport.container.position.x = x / 2;
        spaceport.container.position.y = y / 2;
        spaceport.show(ship).then(newShip => emit(LeaveSpaceportEvent, newShip));
    }
});

const CloseSpaceportSystem = new System({
    name: 'CloseSpaceportSystem',
    events: [LeaveSpaceportEvent],
    args: [DockedShipResource, SingletonComponent] as const,
    step(dockedHolder) {
        // Back in flight: the in-world PlayerShipSelector systems take over.
        dockedHolder.current = undefined;
    }
});

const SpaceportResizeSystem = new System({
    name: 'SpaceportResize',
    events: [ResizeEvent],
    args: [ResizeEvent, SpaceportComponent] as const,
    step({ x, y }, spaceport) {
        spaceport.container.position.x = x / 2;
        spaceport.container.position.y = y / 2;
    }
});

// Every dockable stellar with its parsed PlanetData; the ambient system
// picks the one whose spaceport is currently on its main screen.
const SpaceportAmbientQuery =
    new Query([SpaceportComponent, PlanetDataComponent] as const);
// The ambient snd currently looping (or last looped), so it can be stopped
// when the player enters a venue or launches. null = nothing playing.
const SpaceportAmbientState =
    new Resource<{ currentId: string | null }>('SpaceportAmbientState');

/**
 * Loops the landed stellar's ambient sound (spöb CustSndID -> PlanetData.
 * spaceportSound) while the player is on the spaceport MAIN screen, and
 * stops it inside any venue (outfitter/shipyard/trade/bar/BBS) or overlay
 * and on launch. Client-local per-player: it plays on the UiSoundEvent
 * channel, gated purely by this client's own on-screen state. Ambient
 * sounds are looped per the Bible ("ambient sound to play"); @pixi/sound
 * stop() resets playback, so re-entering the main screen restarts the loop
 * rather than resuming mid-sample.
 */
const SpaceportAmbientSystem = new System({
    name: 'SpaceportAmbientSound',
    args: [SpaceportAmbientState, RunQuery, DisplayAssetDataResource, Emit,
        SingletonComponent] as const,
    step(state, runQuery, displayAssets, emit) {
        const active = runQuery(SpaceportAmbientQuery)
            .find(([spaceport]) => spaceport.onMainScreen);
        const desiredId = active ? active[1].spaceportSound : null;

        if (state.currentId && state.currentId !== desiredId) {
            emit(UiSoundEvent, { id: state.currentId, stop: true });
            state.currentId = null;
        }
        if (desiredId) {
            if (state.currentId !== desiredId) {
                // Newly desired: warm the asset so the loop isn't silent
                // while it streams in (playSound reads getCached).
                displayAssets.data.Sound.get(desiredId);
            }
            emit(UiSoundEvent, { id: desiredId, loop: true });
            state.currentId = desiredId;
        }
    }
});

export const SpaceportPlugin: Plugin = {
    name: 'SpaceportPlugin',
    build(world) {
        world.resources.set(SpaceportAmbientState, { currentId: null });
        // Created here if the status bar plugin hasn't already; both
        // set-if-absent so build order is moot.
        if (!world.resources.get(DockedShipResource)) {
            world.resources.set(DockedShipResource, {});
        }
        world.addSystem(SpaceportProvider);
        world.addSystem(OpenSpaceportSystem);
        world.addSystem(CloseSpaceportSystem);
        world.addSystem(SpaceportResizeSystem);
        world.addSystem(SpaceportAmbientSystem);
    },
    remove(world) {
        world.removeSystem(SpaceportProvider);
        world.removeSystem(OpenSpaceportSystem);
        world.removeSystem(CloseSpaceportSystem);
        world.removeSystem(SpaceportResizeSystem);
        world.removeSystem(SpaceportAmbientSystem);
        world.resources.delete(SpaceportAmbientState);
        // Every dockable stellar got a full Spaceport (outfitter, shipyard,
        // trade center, bar, mission board: a couple of thousand PIXI.Text
        // objects each). Text owns a canvas texture registered in PIXI's
        // global TextureCache, so dropping the container is not enough:
        // without destroy() every system the player passes through leaks
        // its planets' UI canvases (and, once rendered, their GPU
        // textures) for the rest of the session.
        for (const [, entity] of world.entities) {
            const spaceport = entity.components.get(SpaceportComponent);
            if (spaceport) {
                spaceport.container.destroy({ children: true });
                entity.components.delete(SpaceportComponent);
            }
        }
    }
}
