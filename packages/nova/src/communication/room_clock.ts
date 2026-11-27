import { SIMULATION_STEP_MS } from "../nova_plugin/make_system.js";
import { RoomSpeed, RoomSpeedState } from "./rollback_protocol.js";
import { SimulationPacing } from "./simulation_frame.js";

/**
 * Tick pacing: the peer aims to run this many ticks (at 1x; scaled by the
 * room's active speed so the wall-clock send-ahead margin stays ~67 ms at
 * 2x as well) ahead of the extrapolated server clock, so its input records
 * reach the relay before the relay's clock passes their tick. (A record
 * behind the relay clock gets retimed and echoed back as a rollback.)
 */
const PACING_LEAD_TICKS = 4;
/** Clock slew per tick of drift: 1% rate change per tick. */
const PACING_GAIN = 0.01;
/**
 * The pacing rate stays within ±5% of the room's base speed (1x or 2x):
 * drift is corrected by running time imperceptibly fast or slow, never by
 * visibly skipping or doubling ticks. (Gross divergence is snapped
 * instead; see the pump.)
 */
const PACING_MAX_SLEW = 0.05;

/**
 * How long a sync keeps counting toward the clock estimate (with at most
 * SYNC_SAMPLES of them): the estimate is the LEAST DELAYED recent sync
 * extrapolated to now. A tickSync that sat in a busy event loop (the
 * main thread forwarding room traffic to the worker mid-asset-load, a
 * long frame) — or a catch-up reply, a big message that arrives late
 * by its own transfer and decode — used to pull the estimate down until
 * the next one snapped it back up: 10-25 ticks of sudden drift right
 * after a system entry, which the slew took seconds over while every
 * input landed that many ticks late.
 */
const SYNC_WINDOW_MS = 4000;
const SYNC_SAMPLES = 5;
/**
 * A sync this many ticks (scaled by speed) BELOW the estimate is not a
 * late message but a different clock: it replaces the history at once.
 */
const SYNC_RESET_TICKS = 60;

/** A server tick and the local time it arrived. */
interface ClockSample {
    tick: number;
    at: number;
}

/**
 * The room's clock as this peer sees it: the server's canonical tick
 * from its periodic tickSyncs (or a catch-up / roomSpeed reply), when
 * they arrived, and the room's speed schedule (1x or 2x, switching at an
 * announced tick boundary `atTick`) — extrapolated piecewise-linearly
 * from the least delayed recent sync — plus the smoothed drift the
 * pacing slew is derived from.
 */
export class RoomClock {
    /** Recent syncs, oldest first (see SYNC_WINDOW_MS). */
    private samples: ClockSample[] = [];
    /** Lightly smoothed pacing drift; tickSync arrival jitter shifts
     * the raw estimate by a tick or two frame to frame. */
    private smoothedDrift?: number;
    /** Speed before `speedAtTick`. */
    private prevSpeed: RoomSpeed = 1;
    /** Speed from `speedAtTick` onward. */
    private nextSpeed: RoomSpeed = 1;
    /** Tick boundary at which `nextSpeed` takes (or took) effect. */
    private speedAtTick = 0;
    /** Last roomSpeed state announced by the server, if any. */
    private lastSpeedState?: RoomSpeedState;

    /** Records the server's canonical tick as of `now`. */
    sync(tick: number, now = performance.now()) {
        const estimate = this.estimatedServerTick(now);
        if (estimate !== undefined
            && tick < estimate - SYNC_RESET_TICKS * this.nextSpeed) {
            this.samples = [];
        }
        this.samples = this.samples
            .filter(sample => now - sample.at <= SYNC_WINDOW_MS)
            .slice(-(SYNC_SAMPLES - 1));
        this.samples.push({ tick, at: now });
    }

    /**
     * Forgets every sync: a join or resync starts a new timeline, whose
     * clock the reply's tick (sync / setSpeed right after) anchors.
     */
    reset() {
        this.samples = [];
        this.smoothedDrift = undefined;
    }

    /**
     * Records a server speed announcement (`roomSpeed` or `catchUp`),
     * optionally refreshing the clock anchor at the same instant so
     * piecewise extrapolation across `state.atTick` is exact. The sync
     * history restarts from that anchor (or the newest sync): the
     * extrapolation knows a single speed boundary, and a sync from
     * before an earlier one would extrapolate wrongly.
     */
    setSpeed(state: RoomSpeedState, syncTick?: number, now = performance.now()) {
        if (syncTick !== undefined) {
            this.samples = [{ tick: syncTick, at: now }];
        } else {
            this.samples = this.samples.slice(-1);
        }
        const anchorTick = this.samples[0]?.tick ?? 0;
        // A future transition (`atTick > anchorTick`) only exists when
        // flipping between 1x and 2x, so before `atTick` the room runs at
        // the other speed. Once `anchorTick >= atTick`, `state.speed` is
        // already active everywhere from the anchor onward.
        this.prevSpeed = state.atTick > anchorTick
            ? (state.speed === 2 ? 1 : 2)
            : state.speed;
        this.nextSpeed = state.speed;
        this.speedAtTick = state.atTick;
        this.lastSpeedState = { ...state };
    }

    /** The room's clock multiplier (1 or 2) at a given tick. */
    speedAt(tick: number): RoomSpeed {
        return tick >= this.speedAtTick ? this.nextSpeed : this.prevSpeed;
    }

    /** The last speed state announced by the relay, if any. */
    get speedState(): RoomSpeedState | undefined {
        return this.lastSpeedState;
    }

    /** Forgets the smoothed drift (after the local tick jumps). */
    resetDrift() {
        this.smoothedDrift = undefined;
    }

    /** The room's clock now: each recent sync extrapolated piecewise-
     * linearly across any scheduled speed boundary `speedAtTick`, and
     * the furthest of them taken — the least delayed one (messages
     * arrive late, never early). */
    estimatedServerTick(now = performance.now()): number | undefined {
        let estimate: number | undefined;
        for (const sample of this.samples) {
            const extrapolated = this.extrapolate(sample, now);
            if (estimate === undefined || extrapolated > estimate) {
                estimate = extrapolated;
            }
        }
        return estimate;
    }

    private extrapolate({ tick: syncTick, at }: ClockSample, now: number): number {
        const elapsed = Math.max(0, now - at);
        if (syncTick < this.speedAtTick && this.prevSpeed !== this.nextSpeed) {
            const ticksBefore = this.speedAtTick - syncTick;
            const msBefore = ticksBefore * (SIMULATION_STEP_MS / this.prevSpeed);
            if (elapsed <= msBefore) {
                return syncTick + (elapsed / SIMULATION_STEP_MS) * this.prevSpeed;
            }
            return this.speedAtTick
                + ((elapsed - msBefore) / SIMULATION_STEP_MS) * this.nextSpeed;
        }
        return syncTick + (elapsed / SIMULATION_STEP_MS) * this.nextSpeed;
    }

    /**
     * How far `localTick` trails the pacing target — the extrapolated
     * server tick plus the speed-scaled send-ahead lead — right now:
     * the raw drift {@link pacing} slews against, without its smoothing
     * (and without touching it). Negative when the peer runs ahead.
     * Undefined until the first sync.
     */
    behindTicks(localTick: number, now = performance.now()): number | undefined {
        const estimatedServerTick = this.estimatedServerTick(now);
        if (estimatedServerTick === undefined) {
            return undefined;
        }
        return estimatedServerTick
            + PACING_LEAD_TICKS * this.speedAt(localTick) - localTick;
    }

    /**
     * How this peer's clock should slew to track the room's: the room's
     * base speed at `localTick` (1x before `atTick`, 2x from `atTick`
     * onward, or vice versa) multiplied by a small slew factor proportional
     * to the drift between `localTick` and the extrapolated server tick
     * plus a speed-scaled send-ahead lead.
     */
    pacing(localTick: number, now = performance.now()): SimulationPacing | undefined {
        const behindTicks = this.behindTicks(localTick, now);
        if (behindTicks === undefined) {
            return undefined;
        }
        const speed = this.speedAt(localTick);
        this.smoothedDrift = this.smoothedDrift === undefined ? behindTicks
            : this.smoothedDrift * 0.9 + behindTicks * 0.1;
        const slew = 1 + Math.max(-PACING_MAX_SLEW, Math.min(
            PACING_MAX_SLEW, this.smoothedDrift * PACING_GAIN));
        return { rate: speed * slew, behindTicks, speed };
    }
}
