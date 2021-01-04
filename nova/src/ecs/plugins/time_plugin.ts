import { Component } from '../component';
import { Resource } from '../resource';
import { System } from '../system';
import { Plugin } from '../plugin';


export interface Time {
    time: number,
    delta_s: number,
    // Snake case here since Ms is Megaseconds
    delta_ms: number,
}

export const TimeResource = new Resource<Time>({
    name: 'time',
    multiplayer: false,
});

const TimeSingleton = new Component<undefined>({
    name: 'singleton',
});

// Should be a singleton system.
export const TimeSystem = new System({
    name: 'time',
    args: [TimeResource, TimeSingleton] as const,
    step: (time) => {
        // TODO: performance.now for node?
        const now = new Date().getTime();
        time.delta_ms = now - time.time;
        time.delta_s = time.delta_ms / 1000;
        time.time = now;
    }
});


export const TimePlugin: Plugin = {
    name: 'time',
    build: (world) => {
        world.addResource(TimeResource,
            { delta_ms: 0, delta_s: 0, time: new Date().getTime() });
        world.addSystem(TimeSystem);
        world.singletonEntity.addComponent(TimeSingleton, undefined);
    }
}
