import { Entities, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent, MovementSystem } from "nova_ecs/plugins/movement_plugin";
import { Provide, ProvideAsync } from "nova_ecs/provider";
import { System } from "nova_ecs/system";
import { currentIfDraft } from "nova_ecs/utils";
import { FirstAnimation } from "../nova_plugin/animation_plugin";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { AnimationGraphic } from "./animation_graphic";
import { Space } from "./space_resource";
import * as PIXI from "pixi.js";


export const AnimationGraphicComponent = new Component<AnimationGraphic>('AnimationGraphic');
const AnimationGraphicLoader = ProvideAsync({
    provided: AnimationGraphicComponent,
    args: [FirstAnimation, GameDataResource] as const,
    async factory(animation, gameData) {
        const graphic = new AnimationGraphic({
            gameData: currentIfDraft(gameData)!,
            animation: currentIfDraft(animation)!,
        });
        await graphic.buildPromise;
        return graphic;
    }
});

// Add the graphic to the PIXI container in a synchronous provider. Othewise,
// the check that makes sure the entity is still in the world may be
// invalid.
export const AnimationGraphicProvider = Provide({
    provided: AnimationGraphicComponent,
    args: [AnimationGraphicLoader, Space, Entities, UUID] as const,
    factory(graphic, space, entities, uuid) {
        // Only add the graphic to the container if the entity still exists
        if (entities.has(uuid)) {
            space.addChild(graphic.container);
        } else {
            console.log(uuid);
        }
        return graphic;
    }
});

export const ObjectDrawSystem = new System({
    name: "ObjectDrawSystem",
    args: [MovementStateComponent, AnimationGraphicProvider] as const,
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

export const AnimationGraphicPlugin: Plugin = {
    name: 'AnimationGraphicPlugin',
    build(world) {
        world.addSystem(ObjectDrawSystem);
        world.addSystem(AnimationGraphicCleanup);
    }
}
