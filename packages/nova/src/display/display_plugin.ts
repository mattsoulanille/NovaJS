import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { AnimationPlugin } from "../nova_plugin/animation_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { AnimationGraphicPlugin } from "./animation_graphic_plugin.js";
import { AsteroidDisplayPlugin } from "./asteroid_display_plugin.js";
import { BeamDisplayPlugin } from "./beam_display_plugin.js";
import { CloakSoundPlugin } from "./cloak_sound_plugin.js";
import { CursorPlugin } from "./cursor_plugin.js";
import { ExplosionPlugin } from "./explosion_plugin.js";
import { FullscreenPlugin } from "./fullscreen_plugin.js";
import { GateAnimationPlugin } from "./gate_animation_plugin.js";
import { GateMapPlugin } from "./gate_map_plugin.js";
import { JumpFadePlugin } from "./jump_fade_plugin.js";
import { ParticlesPlugin } from "./particles_plugin.js";
import { PlanetCornersPlugin } from "./planet_corners_plugin.js";
import { ProjectileFadePlugin } from "./projectile_fade_plugin.js";
import { MissionInfoPlugin } from "./mission_info_plugin.js";
import { HailDialogPlugin } from "./hail_dialog_plugin.js";
import { PlayerInfoPlugin } from "./player_info_plugin.js";
import { ScreenSizePlugin } from "./screen_size_plugin.js";
import { ShipAnimationPlugin } from "./ship_animation_plugin.js";
import { SoundPlugin } from "./sound_plugin.js";
import { SpaceportPlugin } from "./spaceport_plugin.js";
import { BoardingDisplayPlugin } from "./boarding_plugin.js";
import { ShipMissionOfferPlugin } from "./ship_mission_offer_plugin.js";
import { CameraFocus, Space } from "./space_resource.js";
import { Stage } from "./stage_resource.js";
import { starfield } from "./starfield_plugin.js";
import { SystemEnvironmentPlugin } from "./system_environment_plugin.js";
import { StarmapPlugin } from "./starmap_plugin.js";
import { StatusBarResource, StatusBarPlugin } from "./status_bar.js";
import { StatusMessagePlugin } from "./status_message_plugin.js";
import { TargetCornersPlugin } from "./target_corners_plugin.js";
import { UiSoundTriggersPlugin } from "./ui_sound_triggers_plugin.js";


const CenterShipSystem = new System({
    name: 'CenterShipPlugin',
    args: [Space, CameraFocus, MovementStateComponent, Optional(StatusBarResource),
        PlayerShipSelector] as const,
    step(space, cameraFocus, movementState, statusBar) {
        space.position.x = -movementState.position.x +
            (window.innerWidth - (statusBar?.width ?? 0)) / 2;
        space.position.y = -movementState.position.y + window.innerHeight / 2;
        // Publish the camera focus so per-entity draw systems can pick the
        // toroidal copy of each position nearest the player (loop-boundary
        // rendering). Reuse the object to avoid per-frame allocation.
        cameraFocus.x = movementState.position.x;
        cameraFocus.y = movementState.position.y;
    }
});

const starfieldPlugin = starfield();

export const Display: Plugin = {
    name: 'Display',
    async build(world) {
        const stage = new PIXI.Container();
        stage.name = 'Stage';
        const space = new PIXI.Container();
        space.name = 'Space';
        space.sortableChildren = true;
        stage.addChild(space);
        world.resources.set(Stage, stage);
        world.resources.set(Space, space);
        // Seeded before AnimationGraphicPlugin/StatusBarPlugin add the draw
        // systems that read it; CenterShipSystem refreshes it each frame.
        world.resources.set(CameraFocus, { x: 0, y: 0 });
        await world.addPlugin(ScreenSizePlugin);
        await world.addPlugin(starfieldPlugin);
        // After the starfield so it can hide it on negative murk.
        await world.addPlugin(SystemEnvironmentPlugin);
        await world.addPlugin(StatusBarPlugin);
        await world.addPlugin(StatusMessagePlugin);
        await world.addPlugin(AnimationPlugin);
        await world.addPlugin(AnimationGraphicPlugin);
        world.addSystem(CenterShipSystem);
        await world.addPlugin(TargetCornersPlugin);
        await world.addPlugin(ParticlesPlugin);
        await world.addPlugin(FullscreenPlugin);
        await world.addPlugin(ExplosionPlugin);
        await world.addPlugin(AsteroidDisplayPlugin);
        await world.addPlugin(BeamDisplayPlugin);
        await world.addPlugin(PlanetCornersPlugin);
        // Fades projectile sprites over the final 32/falloff frames of
        // their flight (wëap Falloff). After AsteroidDisplayPlugin since
        // both read the mirrored SimulationTimeResource for a sim-clock
        // fade; needs AnimationGraphicPlugin (added above) for the
        // graphic component and ObjectDrawSystem.
        await world.addPlugin(ProjectileFadePlugin);
        // The starmap, player info, and mission info must precede the
        // spaceport: SpaceportProvider consumes their OpenStarmapResource
        // / OpenPlayerInfoResource / OpenMissionInfoResource (the docked
        // 'm', 'p', and 'i' keys).
        await world.addPlugin(StarmapPlugin);
        await world.addPlugin(PlayerInfoPlugin);
        await world.addPlugin(MissionInfoPlugin);
        // Before both of its triggers (the hail key and the boarding
        // dialogs): each of them calls presentShipOffer, which needs the
        // shared offer popup this plugin owns.
        await world.addPlugin(ShipMissionOfferPlugin);
        await world.addPlugin(HailDialogPlugin);
        await world.addPlugin(SpaceportPlugin);
        // After the spaceport so the plunder/capture dialogs render over
        // the in-flight view; driven by the synced BoardingComponent.
        await world.addPlugin(BoardingDisplayPlugin);
        await world.addPlugin(GateMapPlugin);
        await world.addPlugin(GateAnimationPlugin);
        await world.addPlugin(SoundPlugin);
        await world.addPlugin(CloakSoundPlugin);
        // After SoundPlugin so UiSoundSystem is present to play what these
        // triggers emit.
        await world.addPlugin(UiSoundTriggersPlugin);
        await world.addPlugin(ShipAnimationPlugin);
        await world.addPlugin(JumpFadePlugin);
        // Last, so the cursor's container sits on top of the whole view.
        await world.addPlugin(CursorPlugin);
    },
    async remove(world) {
        await world.removePlugin(CursorPlugin);
        await world.removePlugin(JumpFadePlugin);
        await world.removePlugin(ShipAnimationPlugin);
        await world.removePlugin(UiSoundTriggersPlugin);
        await world.removePlugin(CloakSoundPlugin);
        await world.removePlugin(SoundPlugin);
        await world.removePlugin(SystemEnvironmentPlugin);
        await world.removePlugin(GateAnimationPlugin);
        await world.removePlugin(GateMapPlugin);
        await world.removePlugin(BoardingDisplayPlugin);
        await world.removePlugin(SpaceportPlugin);
        await world.removePlugin(HailDialogPlugin);
        await world.removePlugin(ShipMissionOfferPlugin);
        await world.removePlugin(MissionInfoPlugin);
        await world.removePlugin(PlayerInfoPlugin);
        await world.removePlugin(StarmapPlugin);
        await world.removePlugin(PlanetCornersPlugin);
        await world.removePlugin(BeamDisplayPlugin);
        await world.removePlugin(ProjectileFadePlugin);
        await world.removePlugin(AsteroidDisplayPlugin);
        await world.removePlugin(ExplosionPlugin);
        await world.removePlugin(FullscreenPlugin);
        await world.removePlugin(ParticlesPlugin);
        await world.removePlugin(TargetCornersPlugin);

        world.removeSystem(CenterShipSystem);

        await world.removePlugin(AnimationGraphicPlugin);
        await world.removePlugin(AnimationPlugin);
        await world.removePlugin(StatusBarPlugin);
        await world.removePlugin(StatusMessagePlugin);
        await world.removePlugin(starfieldPlugin);
        await world.removePlugin(ScreenSizePlugin);

        const stage = world.resources.get(Stage);
        const space = world.resources.get(Space);
        if (stage && space) {
            stage.removeChild(space);
        }

        world.resources.delete(Stage);
        world.resources.delete(Space);
        world.resources.delete(CameraFocus);
    }
};
