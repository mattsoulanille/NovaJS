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
import { PlayerShipSelector } from "../client/ship_controller_plugin";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { PlanetDataProvider } from "../nova_plugin/planet_plugin";
import { ShipDataProvider } from "../nova_plugin/ship_plugin";
import { AnimationGraphic } from "./animation_graphic";
import { starfield } from "./starfield_plugin";

export const Stage = new Resource<PIXI.Container>('Stage');

const AnimationComponent = new Component<Animation>('AnimationComponent');

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

const FirstAnimation = FirstAvailable([
    AnimationComponent,
    ShipAnimationComponentProvider,
    PlanetAnimationComponentProvider
]);

const AnimationGraphicComponent = new Component<AnimationGraphic>('AnimationGraphic');
const AnimationGraphicProvider = ProvideAsync({
    provided: AnimationGraphicComponent,
    args: [FirstAnimation, Stage, GameDataResource] as const,
    factory: async (animation, stage, gameData) => {
        const graphic = new AnimationGraphic({
            gameData: currentIfDraft(gameData)!,
            animation: currentIfDraft(animation)!,
        });
        await graphic.buildPromise;
        stage.addChild(graphic.container);
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

const ShipDrawSystem = new System({
    name: "ShipDrawSystem",
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
        world.addSystem(ShipDrawSystem);
        world.addSystem(CenterShipSystem);
    }
};
