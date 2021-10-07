import { Component } from 'nova_ecs/component';
import { Plugin } from 'nova_ecs/plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Provide } from 'nova_ecs/provider';


export const CreateTime = new Component<number>('ProjectileFireTime');
export const CreateTimeProvider = Provide({
    name: "CreateTimeProvider",
    provided: CreateTime,
    args: [TimeResource] as const,
    factory({ time }) {
        return time;
    }
});

export const CreateTimePlugin: Plugin = {
    name: "CreateTimePlugin",
    build(world) {
        world.addSystem(CreateTimeProvider);
    }
}
