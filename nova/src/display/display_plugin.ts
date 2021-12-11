import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin";
import { AnimationGraphicPlugin } from "./animation_graphic_plugin";
import { BeamDisplayPlugin } from "./beam_display_plugin";
import { ExplosionPlugin } from "./explosion_plugin";
import { FullscreenPlugin } from "./fullscreen_plugin";
import { ParticlesPlugin } from "./particles_plugin";
import { PlanetCornersPlugin } from "./planet_corners_plugin";
import { ScreenSizePlugin } from "./screen_size_plugin";
import { ShipAnimationPlugin } from "./ship_animation_plugin";
import { SoundPlugin } from "./sound_plugin";
import { SpaceportPlugin } from "./spaceport_plugin";
import { Space } from "./space_resource";
import { Stage } from "./stage_resource";
import { starfield } from "./starfield_plugin";
import { StatusBarResource, StatusBarPlugin } from "./status_bar";
import { TargetCornersPlugin } from "./target_corners_plugin";


const CenterShipSystem = new System({
    name: 'CenterShipPlugin',
    args: [Space, MovementStateComponent, Optional(StatusBarResource),
        PlayerShipSelector] as const,
    step(space, movementState, statusBar) {
        space.position.x = -movementState.position.x +
            (window.innerWidth - (statusBar?.width ?? 0)) / 2;
        space.position.y = -movementState.position.y + window.innerHeight / 2;
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
        await world.addPlugin(ScreenSizePlugin);
        await world.addPlugin(starfieldPlugin);
        await world.addPlugin(StatusBarPlugin);
        await world.addPlugin(AnimationGraphicPlugin);
        world.addSystem(CenterShipSystem);
        await world.addPlugin(TargetCornersPlugin);
        await world.addPlugin(ParticlesPlugin);
        await world.addPlugin(FullscreenPlugin);
        await world.addPlugin(ExplosionPlugin);
        await world.addPlugin(BeamDisplayPlugin);
        await world.addPlugin(PlanetCornersPlugin);
        await world.addPlugin(SpaceportPlugin);
        await world.addPlugin(SoundPlugin);
        await world.addPlugin(ShipAnimationPlugin);
    },
    async remove(world) {
        await world.removePlugin(SoundPlugin);
        await world.removePlugin(SpaceportPlugin);
        await world.removePlugin(PlanetCornersPlugin);
        await world.removePlugin(BeamDisplayPlugin);
        await world.removePlugin(ExplosionPlugin);
        await world.removePlugin(FullscreenPlugin);
        await world.removePlugin(ParticlesPlugin);
        await world.removePlugin(TargetCornersPlugin);

        world.removeSystem(CenterShipSystem);

        await world.removePlugin(AnimationGraphicPlugin);
        await world.removePlugin(StatusBarPlugin);
        await world.removePlugin(starfieldPlugin);
        await world.removePlugin(ScreenSizePlugin);

        const stage = world.resources.get(Stage);
        const space = world.resources.get(Space);
        if (stage && space) {
            stage.removeChild(space);
        }

        world.resources.delete(Stage);
        world.resources.delete(Space);
    }
};
