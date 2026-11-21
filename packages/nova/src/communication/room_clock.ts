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
 * The room's clock as this peer sees it: the server's canonical tick
 * from its periodic tickSync (or a catch-up / roomSpeed reply), when it
 * arrived, and the room's speed schedule (1x or 2x, switching at an
 * announced tick boundary `atTick`) — extrapolated piecewise-linearly
 * between syncs — plus the smoothed drift the pacing slew is derived from.
 */
export class RoomClock {
    private lastTickSync?: { tick: number, at: number };
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
        this.lastTickSync = {
            tick,
            at: now,
        };
    }

    /**
     * Records a server speed announcement (`roomSpeed` or `catchUp`),
     * optionally refreshing the clock anchor at the same instant so
     * piecewise extrapolation across `state.atTick` is exact.
     */
    setSpeed(state: RoomSpeedState, syncTick?: number, now = performance.now()) {
        if (syncTick !== undefined) {
            this.lastTickSync = { tick: syncTick, at: now };
        }
        const anchorTick = syncTick ?? this.lastTickSync?.tick ?? 0;
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

    /** The room's clock now, extrapolated piecewise-linearly across any
     * scheduled speed boundary `speedAtTick`. */
    estimatedServerTick(now = performance.now()): number | undefined {
        if (!this.lastTickSync) {
            return undefined;
        }
        const elapsed = Math.max(0, now - this.lastTickSync.at);
        const { tick: syncTick } = this.lastTickSync;
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
     * How this peer's clock should slew to track the room's: the room's
     * base speed at `localTick` (1x before `atTick`, 2x from `atTick`
     * onward, or vice versa) multiplied by a small slew factor proportional
     * to the drift between `localTick` and the extrapolated server tick
     * plus a speed-scaled send-ahead lead.
     */
    pacing(localTick: number, now = performance.now()): SimulationPacing | undefined {
        const estimatedServerTick = this.estimatedServerTick(now);
        if (estimatedServerTick === undefined) {
            return undefined;
        }
        const speed = this.speedAt(localTick);
        const behindTicks =
            estimatedServerTick + PACING_LEAD_TICKS * speed - localTick;
        this.smoothedDrift = this.smoothedDrift === undefined ? behindTicks
            : this.smoothedDrift * 0.9 + behindTicks * 0.1;
        const slew = 1 + Math.max(-PACING_MAX_SLEW, Math.min(
            PACING_MAX_SLEW, this.smoothedDrift * PACING_GAIN));
        return { rate: speed * slew, behindTicks, speed };
    }
}
