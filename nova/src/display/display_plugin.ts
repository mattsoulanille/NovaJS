import { Resource } from "novajs/nova_ecs/resource";
import { System } from "novajs/nova_ecs/system";
import { Plugin } from "novajs/nova_ecs/plugin";
import * as PIXI from "pixi.js";


export const PixiContainer = new Resource<PIXI.Container>({
    name: 'PixiContainer',
    multiplayer: false,
    mutable: true,
});


const SquareGraphics = new Resource<PIXI.Graphics>({
    name: 'SquareGraphics',
    multiplayer: false,
    mutable: true,
});

const SquareSystem = new System({
    name: 'SquareSystem',
    args: [SquareGraphics],
    step: (graphics) => {
        graphics.beginFill(0xDE3249);
        graphics.drawRect(50, 50, 100, 100);
        graphics.endFill();
    }
});

export const Display: Plugin = {
    name: 'Display',
    build: (world) => {
        const container = new PIXI.Container();
        const squareGraphics = new PIXI.Graphics();
        container.addChild(squareGraphics);
        world.addResource(PixiContainer, container);
        world.addResource(SquareGraphics, squareGraphics);
        world.addSystem(SquareSystem);
    }
}

