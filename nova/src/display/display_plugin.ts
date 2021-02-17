import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { Plugin } from "nova_ecs/plugin";
import * as PIXI from "pixi.js";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Component, ComponentData } from "nova_ecs/component";
import { EntityBuilder } from "nova_ecs/entity";
import { Provide } from "nova_ecs/provider";
import { v4 } from "uuid";


export const PixiContainer = new Resource<PIXI.Container>({
    name: 'PixiContainer',
    multiplayer: false,
    mutable: true,
});

const SquareGraphics = new Component<PIXI.Graphics>({
    name: 'SquareGraphics',
});

const SquarePhysics = new Component<{
    color: number,
    velocity: { x: number, y: number },
    rotationRate: number,
}>({ name: 'SquarePhysics' })

const SquareProvider = Provide({
    provided: SquareGraphics,
    args: [PixiContainer, SquarePhysics] as const,
    factory: (container, physics) => {
        const graphics = new PIXI.Graphics();
        graphics.beginFill(physics.color);
        graphics.drawRect(-30, -30, 60, 60);
        graphics.endFill();
        container.addChild(graphics);
        return graphics;
    }
});

const SquareSystem = new System({
    name: 'SquareSystem',
    args: [SquareProvider, TimeResource, SquarePhysics] as const,
    step: (graphics, time, physics) => {
        graphics.rotation += time.delta_s * physics.rotationRate;
        graphics.position.x = (graphics.position.x + time.delta_s
            * physics.velocity.x) % 800;
        graphics.position.y = (graphics.position.y + time.delta_s
            * physics.velocity.y) % 800;
    }
});


function randomSquarePhysics(): ComponentData<typeof SquarePhysics> {
    const color = Math.round(Math.random() * 0xFFFFFF);
    return {
        color,
        rotationRate: (Math.random() - 0.5) * 3,
        velocity: {
            x: Math.random() * 30,
            y: Math.random() * 30,
        }
    }
}

export const Display: Plugin = {
    name: 'Display',
    build: (world) => {
        const container = new PIXI.Container();
        world.resources.set(PixiContainer, container);

        world.addSystem(SquareSystem);

        setInterval(() => {
            for (let i = 0; i < 10; i++) {
                world.entities.set(v4(), new EntityBuilder()
                    .addComponent(SquarePhysics, randomSquarePhysics())
                    .build());
            }
        }, 1000);
    }
}

