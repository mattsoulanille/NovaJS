import { Entities } from 'nova_ecs/arg_types';
import { Plugin } from 'nova_ecs/plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Resource } from "nova_ecs/resource";
import { System } from 'nova_ecs/system';
import { GameData } from '../client/gamedata/GameData';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { PlanetTargetComponent } from '../nova_plugin/planet_plugin';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin';
import { AnimationGraphicComponent, ObjectDrawSystem } from './animation_graphic_plugin';
import { Space } from './space_resource';
import { TargetCorners } from "./target_corners_plugin";


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
    },
    after: [ObjectDrawSystem],
});

export const PlanetCornersPlugin: Plugin = {
    name: 'PlanetCornersPlugin',
    build(world) {
        const gameData = world.resources.get(GameDataResource);
        if (!gameData) {
            throw new Error('Expected world to have gameData');
        }

        const space = world.resources.get(Space);
        if (!space) {
            throw new Error('Expected world to have Space resource');
        }

        const targetCorners = new TargetCorners(gameData as GameData, 'planetCorners');
        space.addChild(targetCorners.container);
        world.resources.set(PlanetCornersResource, targetCorners);
        world.addSystem(DrawPlanetCornersSystem);
    }
}

