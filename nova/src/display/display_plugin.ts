import { Animation } from "novadatainterface/Animation";
import { Component } from "nova_ecs/component";
import { DeleteEvent } from "nova_ecs/events";
import { FirstAvailable } from "nova_ecs/first_available";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Provide, ProvideAsync } from "nova_ecs/provider";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { currentIfDraft } from "nova_ecs/utils";
import * as PIXI from "pixi.js";
import { PlayerShipSelector } from "../nova_plugin/ship_controller_plugin";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { PlanetDataProvider } from "../nova_plugin/planet_plugin";
import { ProjectileDataComponent } from "../nova_plugin/projectile_plugin";
import { ShipDataProvider } from "../nova_plugin/ship_plugin";
import { AnimationGraphic } from "./animation_graphic";
import { starfield } from "./starfield_plugin";
import { Entities, UUID } from "nova_ecs/arg_types";

export const Stage = new Resource<PIXI.Container>('Stage');

export const AnimationComponent = new Component<Animation>('AnimationComponent');

const ShipAnimationComponentProvider = Provide({
    provided: AnimationComponent,
    args: [ShipDataProvider],
    factory: (shipData) => {
        return shipData.animation;
    }
});

const PlanetAnimationComponentProvider = Provide({
    provided: AnimationComponent,
    args: [PlanetDataProvider],
    factory: (shipData) => {
        return shipData.animation;
    }
});

const ProjectileAnimationComponentProvider = Provide({
    provided: AnimationComponent,
    args: [ProjectileDataComponent],
    factory: (projectile) => {
        return projectile.animation;
    }
});

const FirstAnimation = FirstAvailable([
    AnimationComponent,
    ShipAnimationComponentProvider,
    PlanetAnimationComponentProvider,
    ProjectileAnimationComponentProvider,
]);

const AnimationGraphicComponent = new Component<AnimationGraphic>('AnimationGraphic');
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

// Add the graphic to the PIXI stage in a synchronous provider. Othewise,
// the check that makes sure the entity is still in the world may be
// invalid.
const AnimationGraphicProvider = Provide({
    provided: AnimationGraphicComponent,
    args: [AnimationGraphicLoader, Stage, Entities, UUID] as const,
    factory(graphic, stage, entities, uuid) {
        // Only add the graphic to the stage if the entity still exists
        if (entities.has(uuid)) {
            stage.addChild(graphic.container);
        } else {
            console.log(uuid);
        }
        return graphic;
    }
});

const AnimationGraphicCleanup = new System({
    name: 'AnimationGraphicCleanup',
    events: [DeleteEvent],
    args: [AnimationGraphicComponent, Stage] as const,
    step: (graphic, stage) => {
        stage.removeChild(graphic.container);
    }
});

const ObjectDrawSystem = new System({
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
    }
});

const CenterShipSystem = new System({
    name: 'CenterShipPlugin',
    args: [Stage, MovementStateComponent, PlayerShipSelector] as const,
    step(stage, movementState) {
        stage.position.x = -movementState.position.x + window.innerWidth / 2;
        stage.position.y = -movementState.position.y + window.innerHeight / 2;
    }
});

export const Display: Plugin = {
    name: 'Display',
    build: async (world) => {
        world.resources.set(Stage, new PIXI.Container());
        await world.addPlugin(starfield());
        world.addSystem(AnimationGraphicCleanup);
        world.addSystem(ObjectDrawSystem);
        world.addSystem(CenterShipSystem);
    }
};
