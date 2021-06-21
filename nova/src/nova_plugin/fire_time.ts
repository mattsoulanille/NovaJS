import { Component } from 'nova_ecs/component';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Provide } from 'nova_ecs/provider';


export const FireTime = new Component<number>('ProjectileFireTime');
export const FireTimeProvider = Provide({
    provided: FireTime,
    args: [TimeResource] as const,
    factory({ time }) {
        return time;
    }
});

