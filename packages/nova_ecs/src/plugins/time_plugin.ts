import { GetWorld } from '../arg_types.js';
import { Resource } from '../resource.js';
import { System } from '../system.js';
import { Plugin } from '../plugin.js';
import { SingletonComponent, World } from '../world.js';


export interface Time {
    time: number,
    delta_s: number,
    // Snake case here since Ms is Megaseconds
    delta_ms: number,
    frame: number,
}

export const TimeResource = new Resource<Time>('time');

/**
 * When set, each step advances time by exactly delta_ms instead of
 * reading the wall clock. Whoever drives the world's stepping is
 * responsible for converting real elapsed time into a number of steps.
 * Simulation worlds need this for determinism; display worlds should
 * keep wall-clock time for smooth rendering.
 */
export const FixedTimestepResource =
    new Resource<{ delta_ms: number }>('FixedTimestep');

/**
 * Puts a world on a fixed timestep with deterministic, 0-based time.
 * Call after TimePlugin has been added.
 */
export function useFixedTimestep(world: World, delta_ms: number) {
    world.resources.set(FixedTimestepResource, { delta_ms });
    const time = world.resources.get(TimeResource);
    if (time) {
        time.time = 0;
        time.delta_ms = 0;
        time.delta_s = 0;
        time.frame = 0;
    }
}

export const TimeSystem = new System({
    name: 'time',
    // Note: Optional() does not support missing resources (getArg throws
    // for them), so the fixed timestep is read through the world.
    args: [TimeResource, GetWorld, SingletonComponent] as const,
    step: (time, world) => {
        const fixedTimestep = world.resources.get(FixedTimestepResource);
        if (fixedTimestep) {
            time.delta_ms = fixedTimestep.delta_ms;
            time.delta_s = fixedTimestep.delta_ms / 1000;
            time.time += fixedTimestep.delta_ms;
            time.frame++;
            return;
        }
        // Wall-clock path (display worlds): epoch ms via Date, which
        // jasmine's mockDate can drive (performance.now cannot be).
        const now = new Date().getTime();
        time.delta_ms = now - time.time;
        time.delta_s = time.delta_ms / 1000;
        time.time = now;
        time.frame++;
    }
});

export const TimePlugin: Plugin = {
    name: 'time',
    build: (world) => {
        world.resources.set(TimeResource,
            { delta_ms: 0, delta_s: 0, time: new Date().getTime(), frame: 0 });
        world.addSystem(TimeSystem);
    }
}
