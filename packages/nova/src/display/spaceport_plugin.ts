import { Emit, Entities, GetEntity, RunQuery } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { EcsEvent } from 'nova_ecs/events';
import { SingletonComponent } from 'nova_ecs/world';
import { ControlsSubject } from '../nova_plugin/core/controls_plugin.js';
import { DisplayAssetDataResource, SimulationGameDataResource } from '../nova_plugin/core/game_data_resource.js';
import { PlanetComponent, PlanetDataComponent } from '../nova_plugin/travel/planet_plugin.js';
import {
    countDeployedFighters, countLandedFighters, mergeDeployedCounts,
} from '../spaceport/deployed_outfits.js';
import { Spaceport } from '../spaceport/spaceport.js';
import { DockedShip, DockedShipResource } from './docked_ship.js';
import { OpenMissionInfoResource } from './mission_info_plugin.js';
import { OpenPlayerInfoResource } from './player_info_plugin.js';
import {
    ResizeEvent, ScreenSize, screenCentre,
} from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { OpenStarmapResource } from './starmap_plugin.js';
import { UiSoundEvent } from './ui_sound.js';
import { MissionShipDoneSystem } from "./mission_ship_done_plugin.js";


/**
 * A stellar's Spaceport, BUILT ON THE FIRST LANDING THERE and kept for the
 * rest of the display world's life (a second landing at the same stellar
 * reuses it; the world's teardown destroys it — see remove()).
 *
 * It used to be a `Provide` over every PlanetComponent, so entering a
 * system built a full Spaceport — outfitter, shipyard, trade center, bar
 * and mission board, a couple of thousand PIXI.Text canvases each — for
 * EVERY stellar in it, unlandable ones included (Jupiter, gates and
 * wormholes got a shipyard; stock data has 461 stellars, 77 of them
 * unlandable, and Sol/Aldebaran/Aurora/K-003 have five each), only to
 * destroy the lot at the next jump. The player opens at most the one
 * they land at, so that is the one that gets built (review #39).
 */
export const SpaceportComponent = new Component<Spaceport>("Spaceport");

/** Every stellar in the system, with its Spaceport if one has been built. */
const PlanetSpaceportQuery = new Query(
    [GetEntity, PlanetComponent, Optional(SpaceportComponent)] as const);

/**
 * `uuid` is the docked ship's uuid in the display world. It is optional
 * because the ship is REMOVED from that world before this fires, so
 * nothing can look it up afterwards — but entities it launched (bay
 * fighters) still reference it, which is how the outfitter counts
 * fighters that are still deployed. Omitted, the outfitter simply
 * assumes everything the player owns is aboard.
 *
 * `landedEscorts` is a live getter for the client's landed-escort roster
 * (browser.ts / spaceport/landed_escorts.ts). Two venues read it: the
 * outfitter, because bay fighters that LANDED with the player are out of
 * the display world but still deployed and still occupy their magazine
 * slots; and the trade center, because a cargo-carrying escort's hold is
 * part of the fleet's cargo space (spaceport/fleet_cargo.ts). A getter
 * because escorts keep touching down while the player shops.
 *
 * `onShipSwap` is how a ship BOUGHT at the shipyard reaches the client
 * before lift-off. A purchase builds a brand-new entity, so the handle
 * browser.ts is holding (`dockedShip.entity` — what the frame loop settles
 * escort deals into, and what every save is written from) would otherwise
 * still be the traded-in hull for the rest of the visit. The spaceport
 * publishes the swap through DockedShip.swapEntity as it happens, and this
 * callback carries it back out to the client. Optional: a client that keeps
 * no handle of its own needs nothing here.
 */
export const OpenSpaceportEvent = new EcsEvent<{
    planetId: string, ship: Entity, uuid?: string,
    landedEscorts?: () =>
        readonly { player: string, uuid: string, entity: Entity }[],
    onShipSwap?: (ship: Entity) => void,
}>('OpenSpaceportEvent');
export const LeaveSpaceportEvent = new EcsEvent<Entity>('LeaveSpaceportEvent');

const OpenSpaceportSystem = new System({
    name: 'OpenSpaceportSystem',
    events: [OpenSpaceportEvent],
    args: [OpenSpaceportEvent, RunQuery, ScreenSize, Emit,
        DockedShipResource, Entities, SimulationGameDataResource,
        DisplayAssetDataResource, ControlsSubject, Stage, OpenStarmapResource,
        OpenPlayerInfoResource, OpenMissionInfoResource,
        SingletonComponent] as const,
    step({ planetId, ship, uuid, landedEscorts, onShipSwap }, runQuery,
        { x, y }, emit, dockedHolder, entities, gameData, displayAssets,
        controls, stage, openStarmap, openPlayerInfo, openMissionInfo) {
        const landedAt = runQuery(PlanetSpaceportQuery)
            .find(([, { id }]) => id === planetId);
        if (!landedAt) {
            return;
        }
        const [planet, , existing] = landedAt;
        let spaceport = existing;
        if (!spaceport) {
            // First landing here this visit: build the stellar's spaceport
            // now (see SpaceportComponent's doc). Its own async build —
            // the stellar's data, its landing PICT and the venues' stock —
            // is what Spaceport.show waits for before its keys go live.
            spaceport = new Spaceport(displayAssets, gameData, planetId,
                controls, openStarmap, openPlayerInfo, openMissionInfo);
            stage.addChild(spaceport.container);
            planet.components.set(SpaceportComponent, spaceport);
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

        // The same roster feeds the trade center's fleet cargo: escorts
        // that landed with the player and can carry cargo (shïp
        // InherentAI 1/2) trade out of their own holds — and, with the
        // live display world (the escorts still flying down), the bar's
        // escort cap.
        spaceport.setLandedEscorts(landedEscorts, uuid, entities);

        // Publish the held ship so the status bar (out-of-world while docked)
        // keeps drawing its credits/fuel/cargo, and let the spaceport push
        // each venue's live working state through it per-transaction.
        // The swap hook rides along: a shipyard purchase replaces the held
        // hull mid-visit, and the client's own docked handle has to follow
        // it (see OpenSpaceportEvent's doc).
        const dockedShip = new DockedShip(ship, onShipSwap);
        // ...and the roster, so the bar's fleet-wide cargo readout can
        // see the escorts' holds while they are out of every world.
        dockedShip.landedEscorts = landedEscorts;
        dockedShip.playerUuid = uuid;
        dockedHolder.current = dockedShip;
        spaceport.setDockedShip(dockedShip);

        const centre = screenCentre({ x, y });
        spaceport.container.position.x = centre.x;
        spaceport.container.position.y = centre.y;
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
    step(resize, spaceport) {
        const centre = screenCentre(resize);
        spaceport.container.position.x = centre.x;
        spaceport.container.position.y = centre.y;
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
export const SpaceportAmbientSystem = new System({
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
    },
    // #156 pin (shared: *): SpaceportPlugin registers after
    // MissionShipDonePlugin.
    after: [MissionShipDoneSystem],
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
        world.addSystem(OpenSpaceportSystem);
        world.addSystem(CloseSpaceportSystem);
        world.addSystem(SpaceportResizeSystem);
        world.addSystem(SpaceportAmbientSystem);
    },
    remove(world) {
        world.removeSystem(OpenSpaceportSystem);
        world.removeSystem(CloseSpaceportSystem);
        world.removeSystem(SpaceportResizeSystem);
        world.removeSystem(SpaceportAmbientSystem);
        world.resources.delete(SpaceportAmbientState);
        // Every stellar the player landed at got a full Spaceport
        // (outfitter, shipyard, trade center, bar, mission board: a couple
        // of thousand PIXI.Text objects each). Text owns a canvas texture
        // registered in PIXI's global TextureCache, so dropping the
        // container is not enough: without destroy() every system the
        // player passes through leaks its planets' UI canvases (and, once
        // rendered, their GPU textures) for the rest of the session.
        // `children: true` without `texture` is deliberate: Text destroys
        // its own canvas texture regardless, while the Sprites' textures
        // (PICTs, cicns) are shared with the asset cache and stay.
        for (const [, entity] of world.entities) {
            const spaceport = entity.components.get(SpaceportComponent);
            if (spaceport) {
                // One still docked at gives the keyboard back first (see
                // Spaceport.dismiss); a spaceport left bound after its
                // world died would hold it for the rest of the session.
                spaceport.dismiss();
                spaceport.container.destroy({ children: true });
                entity.components.delete(SpaceportComponent);
            }
        }
    }
}
