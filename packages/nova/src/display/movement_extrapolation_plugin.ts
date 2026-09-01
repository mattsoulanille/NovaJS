import { Plugin } from 'nova_ecs/plugin';
import {
    MovementPhysicsComponent, MovementStateComponent, MovementSystem,
    MovementTimeLimitResource,
} from 'nova_ecs/plugins/movement_plugin';

/**
 * Runs the simulation's MovementSystem in the DISPLAY world, on the
 * display's wall-clock TimeResource, so entities keep moving between
 * simulation frames.
 *
 * The simulation runs in a worker at a fixed 60Hz timestep and its
 * state reaches the display asynchronously (the frame pump's
 * step() + snapshot() round trip). Without local integration the
 * display only ever showed the last snapshot that happened to arrive:
 * any rAF that got no fresh one — a steps=0 pump (the fixed-timestep
 * floor plus clock-slew pacing guarantees a sprinkling of these), or a
 * worker round trip that missed the frame — rendered a pixel-identical
 * duplicate, and the following frame double-stepped to catch up. A
 * Linux playtest trace (traces/Trace-20260831T193249-linux.json)
 * showed a metronomic 60Hz presentation (2038/2038 frame intervals at
 * 16.7ms) in which roughly one frame in ten drew stale state
 * (7.6-10.9% depending on the measure, always isolated single
 * frames): motion that "feels like it switches between 60 and 30 fps"
 * while every profiler lane looks idle (main-thread rAF work p99
 * 0.9ms, sim worker p99 3ms).
 *
 * MovementSystem is the very prediction the simulation will compute,
 * so between authoritative frames the display advances every mover by
 * its velocity (and turning) over real elapsed time; each arriving
 * snapshot overwrites MovementState wholesale (a moving entity's
 * position changes every tick, so the bridge's per-component JSON diff
 * always resends it — see BridgeHost.snapshot), which bounds
 * prediction error at about one frame of drift. For a constant
 * velocity the extrapolated position is a CONTINUOUS function of wall
 * time across snapshot arrivals (simPos(N+1) = simPos(N) + v*dt is
 * exactly what extrapolation predicted), so a 165Hz display sub-steps
 * a 60Hz simulation without jitter; only acceleration and turning
 * contribute (bounded, one-frame) correction error. Display-only
 * entities (explosions, debris sparks) carry MovementState but no
 * MovementPhysicsComponent, so the system leaves them alone.
 *
 * It must be the REAL MovementSystem object: the draw systems'
 * `after: [MovementSystem]` edges (AnimationGraphicSystem,
 * CenterShipSystem) are by object identity, and they must read the
 * positions integrated THIS step. The wall clock is tamed through
 * MovementTimeLimitResource instead: a stalled clock (system suspend,
 * debugger, occluded window before the heartbeat notices) integrates
 * at most MAX_EXTRAPOLATION_DELTA_MS, and browser.ts disables the
 * limit's `enabled` while the simulation is paused (novaSim.pause) —
 * a paused sim sends no correcting snapshots, so prediction must
 * freeze with it rather than drift forever.
 */
export const MAX_EXTRAPOLATION_DELTA_MS = 100;

export const MovementExtrapolationPlugin: Plugin = {
    name: 'MovementExtrapolation',
    build(world) {
        world.resources.set(MovementTimeLimitResource, {
            enabled: true,
            maxDeltaMs: MAX_EXTRAPOLATION_DELTA_MS,
        });
        world.addComponent(MovementStateComponent);
        world.addComponent(MovementPhysicsComponent);
        world.addSystem(MovementSystem);
    },
    remove(world) {
        world.removeSystem(MovementSystem);
        world.resources.delete(MovementTimeLimitResource);
    },
};
