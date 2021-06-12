import { Animation } from "novadatainterface/Animation";
import { ExplosionData } from "novadatainterface/ExplosionData";
import { Component } from "nova_ecs/component";
import { FirstAvailable } from "nova_ecs/first_available";
import { Plugin } from "nova_ecs/plugin";
import { Provide } from "nova_ecs/provider";
import { PlanetDataProvider } from "./planet_plugin";
import { ProjectileDataComponent } from "./projectile_plugin";
import { ShipDataProvider } from "./ship_plugin";

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

export const ExplosionDataComponent
    = new Component<ExplosionData>('ExplosionData');

const ExplosionAnimationComponentProvider = Provide({
    provided: AnimationComponent,
    args: [ExplosionDataComponent],
    factory: explosion => explosion.animation,
});

export const FirstAnimation = FirstAvailable([
    AnimationComponent,
    ShipAnimationComponentProvider,
    PlanetAnimationComponentProvider,
    ProjectileAnimationComponentProvider,
    ExplosionAnimationComponentProvider,
]);

export const AnimationPlugin: Plugin = {
    name: 'AnimationPlugin',
    build(world) {
        world.addComponent(AnimationComponent);
        world.addComponent(ExplosionDataComponent);
    }
}
