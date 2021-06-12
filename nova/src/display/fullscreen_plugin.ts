import { Plugin } from 'nova_ecs/plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { ControlStateEvent } from '../nova_plugin/ship_controller_plugin';
import { PixiAppResource } from './pixi_app_resource';


const FullscreenSystem = new System({
    name: "FullscreenSystem",
    events: [ControlStateEvent],
    args: [ControlStateEvent, PixiAppResource, SingletonComponent] as const,
    step(event, app) {
        if (event.get("fullscreen") === "start") {
            app.view.requestFullscreen();
        }
    }
});

export const FullscreenPlugin: Plugin = {
    name: "FullscreenPlugin",
    build(world) {
        world.addSystem(FullscreenSystem);
    }
}
