import { Plugin } from "nova_ecs/plugin";
import { Resource } from "nova_ecs/resource";

export type Platform = 'node' | 'browser' | 'worker';
export const PlatformResource = new Resource<Platform>('PlatformComponent');

export const PlatformPlugin: Plugin = {
    name: 'PlatformPlugin',
    build(world) {
        if (world.resources.has(PlatformResource)) {
            return;
        }
        const isWorker = typeof (globalThis as { importScripts?: unknown }).importScripts === 'function'
            && typeof window === 'undefined';
        const platform: Platform =
            isWorker ? 'worker' : (typeof window === 'object' ? 'browser' : 'node');

        world.resources.set(PlatformResource, platform);
    }
}
