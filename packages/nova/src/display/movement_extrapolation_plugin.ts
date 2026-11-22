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
 * contribute (bounded, one-frame) correction error. That continuity
 * holds only if each snapshot is drawn at the instant it represents: one
 * that lands late (a round trip that overran frames) or carries fewer
 * ticks than its frame was worth (1 of a 1-then-3 split at 2x) is OLDER
 * than what the display already showed, and drawing it as-is snapped
 * every synced entity backward. The frame pump's presentation clock
 * (advanceDisplayClock below) advances such a snapshot to the display's
 * time; an on-time one is still drawn exactly as the simulation left it.
 * Display-only
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

/**
 * A snapshot that landed since the last display frame, with the pump's
 * accounting for when it was requested.
 */
export interface LandedSnapshot {
    /** The simulation time the snapshot represents (frame.time). */
    simTimeMs: number;
    /**
     * How far the display may draw it AHEAD of `simTimeMs`: the simulation
     * time the pump had accrued but not yet stepped when it asked for the
     * snapshot, plus the frames the round trip overran. See
     * {@link snapshotMaxLeadMs}.
     */
    maxLeadMs: number;
}

/**
 * The most a snapshot may be drawn ahead of the simulation time it carries.
 *
 * The pump requests it at frame timestamp `pumpFrameMs`, having stepped
 * every whole tick its time debt covered and carried `debtMs` (simulation
 * ms) over. So the simulation's ideal clock at that frame was the
 * snapshot's time plus `debtMs`, and every further frame the round trip
 * spent in flight before the PREVIOUS display frame (the one it should have
 * landed for) adds that frame's worth at `rate`. The display never draws
 * past that ideal clock, so a simulation that has truly fallen behind (the
 * catch-up cap, a stall) is shown where it is rather than predicted away.
 */
export function snapshotMaxLeadMs(options: {
    debtMs: number,
    pumpFrameMs: number,
    previousFrameMs: number,
    rate: number,
}): number {
    return Math.max(0, options.debtMs)
        + Math.max(0, options.previousFrameMs - options.pumpFrameMs)
        * options.rate;
}

/**
 * The display's presentation clock: which simulation time this display
 * frame shows, and how far to draw the freshly-synced entities ahead of
 * their snapshot to show it.
 *
 * Between snapshots the clock runs at the simulation's rate (the room speed
 * times the pacing slew), exactly as wall-clock extrapolation moves the
 * unsynced entities. When a snapshot lands:
 *
 * - on time (it carries the clock's own time, or a later one — a catch-up):
 *   the clock takes the snapshot's time and the synced entities are drawn
 *   exactly where the simulation put them (lead 0). This is the ordinary
 *   frame, and the rule that a just-spawned projectile is drawn AT the
 *   muzzle holds;
 * - stale (it carries an EARLIER time than the clock has already shown):
 *   the synced entities are advanced by the difference, up to
 *   `maxLeadMs`, so nothing moves backward. Before this, a stale snapshot
 *   was drawn as if it were current: every round trip that overran a frame
 *   (the worker busy resimulating a rollback, a GC) became a backward snap
 *   of the frames it overran followed by a forward catch-up, and at 2x a
 *   pump that stepped 1 tick where the frame was worth 2 (the next one
 *   stepping 3) drew the half-frame / one-and-a-half-frame stutter.
 *
 * `previousSimTimeMs` undefined (first frame, after a pause, a new system)
 * adopts the snapshot's time. Pure, so the handoff can be pinned without a
 * browser.
 */
export function advanceDisplayClock(options: {
    previousSimTimeMs: number | undefined,
    frameDeltaMs: number,
    rate: number,
    snapshot?: LandedSnapshot,
}): { simTimeMs: number | undefined, syncedLeadMs: number } {
    const { previousSimTimeMs, snapshot } = options;
    const predicted = previousSimTimeMs === undefined ? undefined
        : previousSimTimeMs + Math.max(0, options.frameDeltaMs) * options.rate;
    if (!snapshot) {
        return { simTimeMs: predicted, syncedLeadMs: 0 };
    }
    if (predicted === undefined || predicted <= snapshot.simTimeMs) {
        return { simTimeMs: snapshot.simTimeMs, syncedLeadMs: 0 };
    }
    const lead = Math.min(predicted - snapshot.simTimeMs,
        Math.max(0, snapshot.maxLeadMs));
    return { simTimeMs: snapshot.simTimeMs + lead, syncedLeadMs: lead };
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
