import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent, MovementSystem } from "nova_ecs/plugins/movement_plugin";
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
import { ProjectileSpinPlugin } from "./projectile_spin_plugin.js";
import { MissionInfoPlugin } from "./mission_info_plugin.js";
import { MovementExtrapolationPlugin } from "./movement_extrapolation_plugin.js";
import { HailDialogPlugin } from "./hail_dialog_plugin.js";
import { PlayerInfoPlugin } from "./player_info_plugin.js";
import {
    DisplayScaleResource, ScreenSizePlugin, WorldScreenSize,
} from "./screen_size_plugin.js";
import { ShipAnimationPlugin } from "./ship_animation_plugin.js";
import { ShipPhysicsDisplayPlugin } from "./ship_physics_display_plugin.js";
import { SoundPlugin } from "./sound_plugin.js";
import { SpaceportPlugin } from "./spaceport_plugin.js";
import { BoardingDisplayPlugin } from "./boarding_plugin.js";
import { MissionShipDonePlugin } from "./mission_ship_done_plugin.js";
import { ShipMissionOfferPlugin } from "./ship_mission_offer_plugin.js";
import { CameraFocus, Space } from "./space_resource.js";
import { DisplayRoot, Stage, WorldLayer } from "./stage_resource.js";
import { starfield } from "./starfield_plugin.js";
import { SystemEnvironmentPlugin } from "./system_environment_plugin.js";
import { StarmapPlugin } from "./starmap_plugin.js";
import { StatusBarResource, StatusBarPlugin } from "./status_bar.js";
import { StatusMessagePlugin } from "./status_message_plugin.js";
import { TargetCornersPlugin } from "./target_corners_plugin.js";
import { UiSoundTriggersPlugin } from "./ui_sound_triggers_plugin.js";


/**
 * Where the world view's origin goes: the centre of the part of the
 * window the status bar does not cover.
 *
 * `statusBarWidth` is a UI-LAYER measurement, so it is multiplied by the
 * UI scale to become a distance in world-layer units — otherwise a
 * scaled-up status bar would shove the camera by the wrong amount.
 * `screen` is the WORLD-logical viewport, which the global scale shrinks.
 */
export function cameraCentre(screen: { x: number, y: number },
    statusBarWidth: number, uiScale: number): { x: number, y: number } {
    return {
        x: (screen.x - statusBarWidth * uiScale) / 2,
        y: screen.y / 2,
    };
}

const CenterShipSystem = new System({
    name: 'CenterShipPlugin',
    args: [Space, CameraFocus, MovementStateComponent, Optional(StatusBarResource),
        WorldScreenSize, DisplayScaleResource, PlayerShipSelector] as const,
    step(space, cameraFocus, movementState, statusBar, screen, scale) {
        const centre = cameraCentre(screen, statusBar?.width ?? 0, scale.ui);
        space.position.x = -movementState.position.x + centre.x;
        space.position.y = -movementState.position.y + centre.y;
        // Publish the camera focus so per-entity draw systems can pick the
        // toroidal copy of each position nearest the player (loop-boundary
        // rendering). Reuse the object to avoid per-frame allocation.
        cameraFocus.x = movementState.position.x;
        cameraFocus.y = movementState.position.y;
    },
    // The camera must read the position MovementExtrapolationPlugin
    // integrated THIS step, or the player ship drifts off-center by one
    // frame of motion.
    after: [MovementSystem],
});

const starfieldPlugin = starfield();

export const Display: Plugin = {
    name: 'Display',
    async build(world) {
        // Two layers under one root, so the UI can be scaled on its own
        // (display_scale.ts): the world view never moves with the UI
        // scale, and every UI element keeps adding itself to `Stage`
        // exactly as before.
        const root = new PIXI.Container();
        root.name = 'DisplayRoot';
        const worldLayer = new PIXI.Container();
        worldLayer.name = 'WorldLayer';
        const stage = new PIXI.Container();
        stage.name = 'Stage';
        root.addChild(worldLayer, stage);
        const space = new PIXI.Container();
        space.name = 'Space';
        space.sortableChildren = true;
        worldLayer.addChild(space);
        world.resources.set(DisplayRoot, root);
        world.resources.set(WorldLayer, worldLayer);
        world.resources.set(Stage, stage);
        world.resources.set(Space, space);
        // Seeded before AnimationGraphicPlugin/StatusBarPlugin add the draw
        // systems that read it; CenterShipSystem refreshes it each frame.
        world.resources.set(CameraFocus, { x: 0, y: 0 });
        await world.addPlugin(ScreenSizePlugin);
        // Before StatusBarPlugin and UiSoundTriggersPlugin: both read the
        // derived ShipPhysicsComponent, which does not cross the bridge.
        await world.addPlugin(ShipPhysicsDisplayPlugin);
        // Keeps motion advancing on wall-clock time between simulation
        // snapshots; every draw system that declares `after:
        // [MovementSystem]` (ObjectDrawSystem, CenterShipSystem) then
        // reads the freshly integrated positions.
        await world.addPlugin(MovementExtrapolationPlugin);
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
        // Cycles a spinning shot's sprite frames on the sim clock instead
        // of picking one from its heading (wëap Flags 0x0001, rate from
        // BeamWidth). Same requirements as the fade above: the mirrored
        // SimulationTimeResource, and AnimationGraphicPlugin for the
        // graphic component and ObjectDrawSystem, which it overrides.
        await world.addPlugin(ProjectileSpinPlugin);
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
        // Owns the ShipDoneText popup, which BoardingDisplayPlugin below
        // presents through for board/rescue goals — so it must be built
        // first, for the same reason ShipMissionOfferPlugin is.
        await world.addPlugin(MissionShipDonePlugin);
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
        await world.removePlugin(MissionShipDonePlugin);
        await world.removePlugin(ShipMissionOfferPlugin);
        await world.removePlugin(MissionInfoPlugin);
        await world.removePlugin(PlayerInfoPlugin);
        await world.removePlugin(StarmapPlugin);
        await world.removePlugin(PlanetCornersPlugin);
        await world.removePlugin(BeamDisplayPlugin);
        await world.removePlugin(ProjectileFadePlugin);
        await world.removePlugin(ProjectileSpinPlugin);
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
        await world.removePlugin(MovementExtrapolationPlugin);
        await world.removePlugin(ShipPhysicsDisplayPlugin);
        await world.removePlugin(ScreenSizePlugin);

        const worldLayer = world.resources.get(WorldLayer);
        const space = world.resources.get(Space);
        if (worldLayer && space) {
            worldLayer.removeChild(space);
        }
        const root = world.resources.get(DisplayRoot);
        root?.removeChildren();
        // The four layer containers are this world's own: destroy them
        // (WITHOUT children — every plugin above has taken its objects
        // down, and anything still parented here is somebody else's, e.g.
        // a pooled sprite, so it is only detached). Review #40.
        for (const layer of [space, world.resources.get(Stage), worldLayer,
            root]) {
            layer?.destroy();
        }

        world.resources.delete(DisplayRoot);
        world.resources.delete(WorldLayer);
        world.resources.delete(Stage);
        world.resources.delete(Space);
        world.resources.delete(CameraFocus);
    }
};
