import { Resource } from "nova_ecs/resource";
import { Time } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";

/**
 * The simulation's logical clock, mirrored into the display world by
 * applySimulationFrame each frame. The display world's own
 * TimeResource is wall-clock epoch milliseconds (for smooth
 * rendering), so display systems that compare against sim-clock
 * timestamps carried on components (e.g. DebrisComponent.expires) must
 * read this instead — comparing a sim timestamp against the wall clock
 * is off by ~50 years.
 */
export const SimulationTimeResource = new Resource<Time>('SimulationTime');

/** Before the first frame arrives, the sim clock reads as t=0. */
export function defaultSimulationTime(): Time {
    return { time: 0, delta_s: 0, delta_ms: 0, frame: 0 };
}

/**
 * Resolves once the display world has applied `frames` more simulation
 * frames (applySimulationFrame replaces SimulationTimeResource with each
 * frame's time), or after `timeoutMs` (a paused simulation sends none;
 * a frame pump stalled on a cold load, the first moments in a system,
 * sends them late, which is why the cap is a generous second rather than
 * a few frames).
 *
 * WHY. A key reaches the display's own handlers synchronously, but the
 * simulation sees it only on its next step, and the display world shows
 * the result one snapshot after that. So a display action that reads
 * state another key just changed — the comm dialog reading the stellar a
 * number key just selected — reads it stale if it reads at once: 'y'
 * pressed right behind '2' hailed the previous stellar while the
 * Stellar Navigation panel, a frame later, named the new one. Two frames
 * suffice: the first may come from a step that was already in flight at
 * the press, but the step behind the second was requested after it
 * returned, and so after the key had been sent.
 */
export function afterSimulationFrames(world: World, frames = 2,
    timeoutMs = 1000): Promise<void> {
    return new Promise(resolve => {
        const start = Date.now();
        let last = world.resources.get(SimulationTimeResource);
        let seen = 0;
        const poll = () => {
            const now = world.resources.get(SimulationTimeResource);
            if (now !== last) {
                last = now;
                seen++;
            }
            if (seen >= frames || Date.now() - start >= timeoutMs) {
                resolve();
                return;
            }
            setTimeout(poll, 5);
        };
        poll();
    });
}
