import { Resource } from 'nova_ecs/resource';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { System } from 'nova_ecs/system';

export const ResizeEvent = new EcsEvent<{ x: number, y: number }>('Resize');
export const ScreenSize = new Resource<{ x: number, y: number }>('ScreenSize');

const ResizeSystem = new System({
    name: 'ResizeSystem',
    events: [ResizeEvent],
    args: [ResizeEvent, ScreenSize] as const,
    step({ x, y }, screenSize) {
        screenSize.x = x;
        screenSize.y = y;
    }
});

export const ScreenSizePlugin: Plugin = {
    name: 'ScreenSize',
    build(world) {
        world.resources.set(ScreenSize,
            { x: window.innerWidth, y: window.innerHeight })
        world.addSystem(ResizeSystem);
    }
}
