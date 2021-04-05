import { Plugin } from "nova_ecs/plugin";
import { Resource } from "nova_ecs/resource";

export type Platform = 'node' | 'browser';
export const PlatformResource = new Resource<Platform>('PlatformComponent');

export const PlatformPlugin: Plugin = {
    name: 'PlatformPlugin',
    build(world) {
        const platform: Platform =
            (typeof window === 'object') ? 'browser' : 'node';

        world.resources.set(PlatformResource, platform);
    }
}
