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

/**
 * How long the display will go on predicting with NO authoritative movement
 * behind it before it stops and simply holds the last known picture.
 *
 * The per-frame clamp above bounds ONE step; it says nothing about a run of
 * them. A multiplayer RESYNC is exactly such a run: while
 * `SimulationBridge.resyncing` is set, `step()` refuses to step (stepping a
 * world being rebuilt from the input log would fork the timeline) and
 * `snapshot()` returns an EMPTY frame on purpose, for as long as the
 * recovery takes — up to RESYNC_JOIN_TIMEOUT_MS (20 seconds), times
 * RESYNC_MAX_ATTEMPTS. Nothing told the display, so every ship coasted on
 * its last known velocity for the whole hold and then teleported when the
 * first real snapshot landed. A turning ship pirouetted the entire time. A
 * wedged worker and a link that simply stops delivering look the same from
 * here, and get the same treatment.
 *
 * Holding still is the honest picture: the client genuinely does not know
 * where anything is. It is also what the pause path already does, for the
 * same reason (a paused simulation sends no corrections).
 *
 * The threshold has to clear every LEGITIMATE gap by a wide margin, because
 * covering those gaps is the whole point of this plugin: a steps=0 pump, a
 * worker round trip that missed a frame — isolated single frames at 60Hz,
 * so tens of milliseconds. Half a second is two orders of magnitude above
 * that and two orders below the resync hold it is meant to catch.
 */
export const STALE_SNAPSHOT_MS = 500;

/**
 * Whether wall-clock extrapolation should run this display frame.
 *
 * Pure, so the rule can be pinned without a browser. `lastMovementSyncMs`
 * is when a frame last brought authoritative MovementState — NOT merely
 * when a frame arrived, which a resync hold also produces (empty ones).
 * `undefined` means none ever has, which is the state a world is in before
 * its first snapshot: nothing to predict FROM, so nothing is predicted.
 */
export function shouldExtrapolate(options: {
    paused: boolean,
    now: number,
    lastMovementSyncMs: number | undefined,
}): boolean {
    if (options.paused || options.lastMovementSyncMs === undefined) {
        return false;
    }
    return options.now - options.lastMovementSyncMs < STALE_SNAPSHOT_MS;
}

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
