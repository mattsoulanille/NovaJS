/**
 * ============================================================================
 * A taken frame is applied, never dropped
 * ============================================================================
 *
 * The simulation's frames are DELTAS against what the host last sent: the
 * moment the pump takes one (`bridge.snapshot()`), the host counts it as
 * delivered. Before it can be applied, the frame's game-data references
 * are loaded into the display's own caches (stageSimulationFrameGameData),
 * which can go to the network — and fail, for as long as the server is
 * down or restarting. The pump used to log that failure and DROP the
 * frame. Everything in it was then lost for good: an entity it added
 * never appeared (every later delta for it: "not in the display world"),
 * one it removed stayed as a ghost, and the client's fleet ledger, which
 * reads those adds and removals, missed them too — an escort booked LOST
 * whose return was in the dropped frame stayed on the lost roster while
 * it flew, and the next lift-off respawned it beside itself (the escort
 * double of 2026-11-27, which followed a reconnect to a restarted server).
 *
 * So a frame whose staging fails is HELD, with every frame taken after it,
 * and the whole backlog is retried in order on the next pump: transport
 * failures are not cached (novadatainterface's Gettable), so the retry
 * loads what the outage refused. A frame that still cannot be staged after
 * HOLD_MS is applied as it is — the old outcome for that one frame's
 * unresolvable components (applySimulationFrame drops them with a
 * warning), rather than a display frozen behind data that will never load.
 */
import type { SimulationFrame } from '../communication/simulation_frame.js';

/** How long the head frame may wait for its game data before it is
 * applied without it. */
export const HOLD_MS = 10_000;

export class FrameBacklog {
    private frames: SimulationFrame[] = [];
    /** When the head frame's staging first failed. */
    private blockedSince: number | undefined;

    get length(): number {
        return this.frames.length;
    }

    push(frame: SimulationFrame): void {
        this.frames.push(frame);
    }

    /** A new delta stream (a new live system): nothing held applies to it. */
    clear(): void {
        this.frames = [];
        this.blockedSince = undefined;
    }

    /**
     * Stages and applies the held frames in order. Stops at the first frame
     * whose staging throws, keeping it and everything after it for the next
     * drain, and returns that error (undefined once the backlog is empty).
     * `stillCurrent` is checked after each await: a transition that took
     * the system away ends the drain (the caller clears the backlog when it
     * takes up the next one).
     */
    async drain(stage: (frame: SimulationFrame) => Promise<void>,
        apply: (frame: SimulationFrame) => void,
        stillCurrent: () => boolean,
        now: () => number = () => performance.now()): Promise<unknown> {
        while (this.frames.length > 0) {
            const frame = this.frames[0];
            try {
                await stage(frame);
            } catch (error) {
                if (!stillCurrent()) {
                    return undefined;
                }
                this.blockedSince ??= now();
                if (now() - this.blockedSince < HOLD_MS) {
                    return error;
                }
                console.error('Applying a simulation frame whose game data '
                    + `could not be loaded for ${HOLD_MS} ms:`, error);
            }
            if (!stillCurrent()) {
                return undefined;
            }
            this.blockedSince = undefined;
            this.frames.shift();
            apply(frame);
        }
        return undefined;
    }
}
