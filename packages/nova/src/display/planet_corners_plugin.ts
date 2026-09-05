import { Entities } from 'nova_ecs/arg_types';
import { Plugin } from 'nova_ecs/plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Resource } from "nova_ecs/resource";
import { System } from 'nova_ecs/system';
import { DisplayAssetDataResource } from '../nova_plugin/game_data_resource.js';
import { PlanetTargetComponent } from '../nova_plugin/planet_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { AnimationGraphicComponent, ObjectDrawSystem } from './animation_graphic_plugin.js';
import { Space } from './space_resource.js';
import { cornersSweepSystem, TargetCorners } from "./target_corners_plugin.js";


const PlanetCornersResource = new Resource<TargetCorners>('PlanetCornersResource');

const DrawPlanetCornersSystem = new System({
    name: "DrawPlanetCornersSystem",
    args: [PlanetTargetComponent, TimeResource, PlanetCornersResource, Entities,
        PlayerShipSelector] as const,
    step({ target }, time, targetCorners, entities) {
        if (!target) {
            targetCorners.visible = false;
            targetCorners.targetUuid = undefined;
            return;
        }

        const targetGraphic = entities.get(target)?.components
            .get(AnimationGraphicComponent);
        if (!targetGraphic) {
            targetCorners.visible = false;
            targetCorners.targetUuid = undefined;
            return;
        }

        targetCorners.step(time.time, target, targetGraphic.size);
        targetCorners.setPosition(targetGraphic.container.position);
        targetCorners.visible = true;
        targetCorners.drawnThisStep = true;
    },
    after: [ObjectDrawSystem],
});

// Same sweep as the ship corners: the player's entity leaves the display
// world on landing, so nothing would otherwise take the stellar reticle
// down (see cornersSweepSystem).
const SweepPlanetCornersSystem = cornersSweepSystem('SweepPlanetCornersSystem',
    PlanetCornersResource, DrawPlanetCornersSystem);

export const PlanetCornersPlugin: Plugin = {
    name: 'PlanetCornersPlugin',
    build(world) {
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        if (!displayAssets) {
            throw new Error('Expected world to have display assets');
        }

        const space = world.resources.get(Space);
        if (!space) {
            throw new Error('Expected world to have Space resource');
        }

        const targetCorners = new TargetCorners(displayAssets, 'planetCorners');
        space.addChild(targetCorners.container);
        world.resources.set(PlanetCornersResource, targetCorners);
        world.addSystem(DrawPlanetCornersSystem);
        world.addSystem(SweepPlanetCornersSystem);
    },
    remove(world) {
        // Destroyed, children included: the corner sprites are per-world
        // and leaked with every transit (review #40). Their cicn textures
        // are the asset cache's and are left alone.
        world.resources.get(PlanetCornersResource)?.container
            .destroy({ children: true });
        world.removeSystem(DrawPlanetCornersSystem);
        world.removeSystem(SweepPlanetCornersSystem);
        world.resources.delete(PlanetCornersResource);
    }
}
