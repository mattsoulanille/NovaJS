import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { Plugin } from "nova_ecs/plugin";
import * as PIXI from "pixi.js";
import { TimeResource } from "nova_ecs/plugins/time_plugin";


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

        squareGraphics.beginFill(0xDE3249);
        squareGraphics.drawRect(-50, -50, 100, 100);
        squareGraphics.endFill();

        container.addChild(squareGraphics);
        world.resources.set(PixiContainer, container);
        world.resources.set(SquareGraphics, squareGraphics);
        world.addSystem(SquareSystem);
    }
}

