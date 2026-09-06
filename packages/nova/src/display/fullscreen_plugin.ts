import { Plugin } from 'nova_ecs/plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { EcsControlEvent } from '../nova_plugin/controls_plugin.js';
import { PixiAppResource } from './pixi_app_resource.js';


const FullscreenSystem = new System({
    name: "FullscreenSystem",
    events: [EcsControlEvent],
    args: [EcsControlEvent, PixiAppResource, SingletonComponent] as const,
    step(events, app) {
        for (const { action, state } of events) {
            // PIXI types its view as an ICanvas (which may be an
            // OffscreenCanvas); only a DOM canvas can go fullscreen.
            if (action === "fullscreen" && state === "start"
                && app.view instanceof HTMLCanvasElement) {
                app.view.requestFullscreen();
            }
        }
    }
});

export const FullscreenPlugin: Plugin = {
    name: "FullscreenPlugin",
    build(world) {
        world.addSystem(FullscreenSystem);
    },
    remove(world) {
        world.removeSystem(FullscreenSystem);
    }
}
