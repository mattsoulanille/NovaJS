import { Resource } from "novajs/nova_ecs/resource";
import { Plugin } from "nova_ecs/plugin";
import * as PIXI from "pixi.js";


export const PixiContainer = new Resource<PIXI.Container>({
    name: 'PixiContainer',
    multiplayer: false,
    mutable: true,
});


export const Display: Plugin = {
    name: 'Display',
    build: (world) => {
        world.addResource(PixiContainer, new PIXI.Container());
        world.addSystem
    }
}

