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
 * Optional wall-clock multiplier for display worlds (e.g. 2 when the room
 * runs at 2x speed, #371 R2). Ignored when FixedTimestepResource is set so
 * deterministic simulation worlds are never affected.
 */
export const TimeScaleResource =
    new Resource<{ scale: number }>('TimeScale');

/** Tracks the previous real wall-clock sample for scaled display stepping. */
const WallClockAnchorResource =
    new Resource<{ lastWallMs: number }>('WallClockAnchor');

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
    // The fixed timestep and time scale are optional and read through the world.
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
        const timeScale = world.resources.get(TimeScaleResource);
        let anchor = world.resources.get(WallClockAnchorResource);
        if (timeScale) {
            if (!anchor) {
                anchor = { lastWallMs: now };
                world.resources.set(WallClockAnchorResource, anchor);
            }
            const rawDeltaMs = Math.max(0, now - anchor.lastWallMs);
            anchor.lastWallMs = now;
            const scaledDeltaMs = rawDeltaMs * timeScale.scale;
            time.delta_ms = scaledDeltaMs;
            time.delta_s = scaledDeltaMs / 1000;
            time.time += scaledDeltaMs;
            time.frame++;
            return;
        }
        if (anchor) {
            anchor.lastWallMs = now;
        }
        time.delta_ms = now - time.time;
        time.delta_s = time.delta_ms / 1000;
        time.time = now;
        time.frame++;
    }
});

export const TimePlugin: Plugin = {
    name: 'time',
    build: (world) => {
        const now = new Date().getTime();
        world.resources.set(TimeResource,
            { delta_ms: 0, delta_s: 0, time: now, frame: 0 });
        world.resources.set(WallClockAnchorResource, { lastWallMs: now });
        world.addSystem(TimeSystem);
    }
}
