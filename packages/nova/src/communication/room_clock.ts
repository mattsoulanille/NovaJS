import { SIMULATION_STEP_MS } from "../nova_plugin/make_system.js";
import { SimulationPacing } from "./simulation_frame.js";

/**
 * Tick pacing: the peer aims to run this many ticks ahead of the
 * extrapolated server clock, so its input records reach the relay
 * before the relay's clock passes their tick. (A record behind the
 * relay clock gets retimed for the room but not for its sender —
 * a divergence desync detection then has to clean up.)
 */
const PACING_LEAD_TICKS = 4;
/** Clock slew per tick of drift: 1% rate change per tick. */
const PACING_GAIN = 0.01;
/**
 * The pacing rate stays within ±5% of real time: drift is corrected
 * by running time imperceptibly fast or slow, never by visibly
 * skipping or doubling ticks. (Gross divergence is snapped instead;
 * see the pump.)
 */
const PACING_MAX_SLEW = 0.05;

/**
 * The room's clock as this peer sees it: the server's canonical tick
 * from its periodic tickSync (or a catch-up reply), and when it
 * arrived — extrapolated between syncs — plus the smoothed drift the
 * pacing slew is derived from.
 */
export class RoomClock {
    private lastTickSync?: { tick: number, at: number };
    /** Lightly smoothed pacing drift; tickSync arrival jitter shifts
     * the raw estimate by a tick or two frame to frame. */
    private smoothedDrift?: number;

    /** Records the server's canonical tick as of now. */
    sync(tick: number) {
        this.lastTickSync = {
            tick,
            at: performance.now(),
        };
    }

    /** Forgets the smoothed drift (after the local tick jumps). */
    resetDrift() {
        this.smoothedDrift = undefined;
    }

    /** The room's clock now, extrapolated from the last tickSync. */
    estimatedServerTick(): number | undefined {
        if (!this.lastTickSync) {
            return undefined;
        }
        const elapsed = performance.now() - this.lastTickSync.at;
        return this.lastTickSync.tick + elapsed / SIMULATION_STEP_MS;
    }

    /**
     * How this peer's clock should slew to track the room's: a rate
     * factor proportional to the drift between the local tick and the
     * extrapolated server tick plus a small send-ahead lead, clamped
     * so correction is a gradual speed change rather than a skip.
     */
    pacing(localTick: number): SimulationPacing | undefined {
        const estimatedServerTick = this.estimatedServerTick();
        if (estimatedServerTick === undefined) {
            return undefined;
        }
        const behindTicks =
            estimatedServerTick + PACING_LEAD_TICKS - localTick;
        this.smoothedDrift = this.smoothedDrift === undefined ? behindTicks
            : this.smoothedDrift * 0.9 + behindTicks * 0.1;
        const rate = 1 + Math.max(-PACING_MAX_SLEW, Math.min(
            PACING_MAX_SLEW, this.smoothedDrift * PACING_GAIN));
        return { rate, behindTicks };
    }
}
