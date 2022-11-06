import { Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { AddEvent, DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent, MovementSystem } from "nova_ecs/plugins/movement_plugin";
import { Provide } from "nova_ecs/provider";
import { ProvideAsync } from "nova_ecs/async_provider";
import { System } from "nova_ecs/system";
import { currentIfDraft } from "nova_ecs/utils";
import { AnimationComponent } from "../nova_plugin/animation_plugin";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { PlanetComponent } from "../nova_plugin/planet_plugin";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin";
import { ProjectileComponent } from "../nova_plugin/projectile_data";
import { ShipComponent } from "../nova_plugin/ship_plugin";
import { AnimationGraphic } from "./animation_graphic";
import { Space } from "./space_resource";

export const AnimationGraphicComponent = new Component<AnimationGraphic>('AnimationGraphic');
const AnimationGraphicLoadedComponent = new Component<AnimationGraphic>('AnimationGraphicLoaded');
const AnimationGraphicLoader = ProvideAsync({
    name: "AnimationGraphicLoader",
    provided: AnimationGraphicLoadedComponent,
    args: [AnimationComponent, GameDataResource, GetEntity] as const,
    async factory(animation, gameData, entity) {
        const graphic = new AnimationGraphic({
            gameData: currentIfDraft(gameData)!,
            animation: currentIfDraft(animation)!,
        });
        await graphic.buildPromise;

        // Order sprites
        if (entity.components.has(PlayerShipSelector)) {
            graphic.container.zIndex = 10;
        } else if (entity.components.has(ProjectileComponent)) {
            // TODO: Support projectiles above and below ships.
            graphic.container.zIndex = 9;
        } else if (entity.components.has(ShipComponent)) {
            graphic.container.zIndex = 8;
        } else if (entity.components.has(PlanetComponent)) {
            graphic.container.zIndex = -10;
        }

        return graphic;
    }
});

// Add the graphic to the PIXI container in a synchronous system. Othewise,
// the check that makes sure the entity is still in the world may be
// invalid.
export const AnimationGraphicProvider = Provide({
    name: "AnimationGraphicProvider",
    provided: AnimationGraphicComponent,
    args: [AnimationGraphicLoadedComponent, Space, Entities, UUID] as const,
    factory(graphic, space, entities, uuid) {
        // Only add the graphic to the container if the entity still exists
        if (entities.has(uuid)) {
            space.addChild(graphic.container);
        } else {
            console.log(`Not adding graphic for ${uuid} since it is no longer in the system`);
        }
        return graphic;
    }
});

export const ObjectDrawSystem = new System({
    name: "ObjectDrawSystem",
    args: [MovementStateComponent, AnimationGraphicComponent] as const,
    step: (movementState, graphic) => {
        if (movementState.turning < 0) {
            graphic.setFramesToUse('left');
        } else if (movementState.turning > 0) {
            graphic.setFramesToUse('right');
        } else {
            graphic.setFramesToUse('normal');
        }

        graphic.glowAlpha = movementState.accelerating *
            (1 - (Math.random() * 0.2));

        graphic.container.position.x = movementState.position.x;
        graphic.container.position.y = movementState.position.y;
        graphic.rotation = movementState.rotation.angle;
    },
    after: [MovementSystem],
});

const AnimationGraphicCleanup = new System({
    name: 'AnimationGraphicCleanup',
    events: [DeleteEvent],
    args: [AnimationGraphicComponent, Space] as const,
    step: (graphic, space) => {
        space.removeChild(graphic.container);
    }
});

const AnimationGraphicInsert = new System({
    name: 'AnimationGraphicInsert',
    events: [AddEvent],
    args: [AnimationGraphicComponent, Space] as const,
    step(graphic, space) {
        space.addChild(graphic.container);
    }
});

export const AnimationGraphicPlugin: Plugin = {
    name: 'AnimationGraphicPlugin',
    build(world) {
        world.addSystem(AnimationGraphicLoader);
        world.addSystem(AnimationGraphicProvider);
        world.addSystem(ObjectDrawSystem);
        world.addSystem(AnimationGraphicCleanup);
        world.addSystem(AnimationGraphicInsert);
    },
    remove(world) {
        world.removeSystem(AnimationGraphicLoader);
        world.removeSystem(AnimationGraphicProvider);
        world.removeSystem(ObjectDrawSystem);
        world.removeSystem(AnimationGraphicCleanup);
        world.removeSystem(AnimationGraphicInsert);
    }
}
