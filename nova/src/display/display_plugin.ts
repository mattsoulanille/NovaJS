import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { Plugin } from "nova_ecs/plugin";
import * as PIXI from "pixi.js";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Component } from "nova_ecs/component";
import { EntityBuilder } from "nova_ecs/entity";


export const PixiContainer = new Resource<PIXI.Container>({
    name: 'PixiContainer',
    multiplayer: false,
    mutable: true,
});


const SquareGraphics = new Component<PIXI.Graphics>({
    name: 'SquareGraphics',
});

const SquareSystem = new System({
    name: 'SquareSystem',
    args: [SquareGraphics, TimeResource] as const,
    step: (graphics, time) => {
        graphics.rotation += time.delta_s;
        graphics.position.x = (graphics.position.x + time.delta_s * 10) % 800;
        graphics.position.y = (graphics.position.y + time.delta_s * 15) % 800;
    }
});

export const Display: Plugin = {
    name: 'Display',
    build: (world) => {
        const container = new PIXI.Container();
        const squareGraphics = new PIXI.Graphics();
        const squareGraphics2 = new PIXI.Graphics();

        squareGraphics.beginFill(0xDE3249);
        squareGraphics.drawRect(-50, -50, 100, 100);
        squareGraphics.endFill();

        squareGraphics2.beginFill(0x555555);
        squareGraphics2.drawRect(-100, -50, 200, 100);
        squareGraphics2.endFill();
        squareGraphics2.position.x = 100;

        container.addChild(squareGraphics);
        container.addChild(squareGraphics2);

        world.resources.set(PixiContainer, container);

        world.entities.set('square1', new EntityBuilder()
            .addComponent(SquareGraphics, squareGraphics)
            .build());

        world.entities.set('square2', new EntityBuilder()
            .addComponent(SquareGraphics, squareGraphics2)
            .build());

        world.addSystem(SquareSystem);
    }
}

