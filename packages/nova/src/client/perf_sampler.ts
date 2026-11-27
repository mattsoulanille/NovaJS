/**
 * ============================================================================
 * The performance sampler's arithmetic
 * ============================================================================
 *
 * One {@link PerfWindow} accumulates everything client/perf_telemetry.ts
 * measures between two samples, and {@link PerfWindow.summarize} turns it
 * into the sample's measured sections (common/perf_stats.ts). Pure (no
 * DOM, no PIXI, no clock of its own: every timestamp is passed in), so the
 * specs drive it frame by frame.
 *
 * THE HOT PATH ALLOCATES NOTHING. Every per-frame call takes plain numbers
 * and writes into storage made in the constructor: a typed-array ring of
 * frame times, fixed histogram counters, running sums and maxima, and a
 * fixed set of stall slots overwritten in place. Only summarize() (once a
 * window, every ~12 s) allocates: the sorted copy for the percentiles
 * reuses a scratch array, and the result objects are the sample itself.
 */
import {
    ENTITY_COUNT_KEYS, EntityCounts, FRAME_HISTOGRAM_BOUNDS_MS,
    FRAME_HISTOGRAM_BUCKETS, FrameStats, MAX_STALLS_PER_SAMPLE, PerfSample,
    Stall, STALL_MS,
} from '../common/perf_stats.js';

/** Where the player was during a frame. */
export type PerfPhase = 'space' | 'landed' | 'transit';

/** A gap between landed snapshots past this freezes the picture
 * (frame_pump.ts STALE_SNAPSHOT_MS: extrapolation stops). */
export const SNAPSHOT_GAP_STALE_MS = 500;

/** A heap reading this far below the previous one counts as a GC drop. */
export const HEAP_DROP_MB = 4;

/** Frame times kept per window for the percentiles. 15 s at 240 Hz is
 * 3600; past the capacity the percentiles see the first CAPACITY frames
 * (the counters, mean, worst and histogram still see every frame). */
export const FRAME_RING_CAPACITY = 8192;

/** One decimal: tenths of a millisecond are plenty, and the sample stays
 * short. */
export function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * The value at quantile `q` (0..1) of the first `n` entries of an
 * ascending array: the nearest-rank definition (the smallest value with
 * at least q of the data at or below it). 0 for an empty array.
 */
export function nearestRank(sorted: ArrayLike<number>, n: number,
    q: number): number {
    if (n <= 0) {
        return 0;
    }
    const rank = Math.min(n, Math.max(1, Math.ceil(q * n)));
    return sorted[rank - 1];
}

/** The histogram bucket a frame time falls in (FRAME_HISTOGRAM_BOUNDS_MS
 * upper bounds, inclusive; the last bucket holds the rest). */
export function histogramBucket(ms: number): number {
    for (let i = 0; i < FRAME_HISTOGRAM_BOUNDS_MS.length; i++) {
        if (ms <= FRAME_HISTOGRAM_BOUNDS_MS[i]) {
            return i;
        }
    }
    return FRAME_HISTOGRAM_BUCKETS - 1;
}

/** A stall slot, reused in place (a Stall plus where it started, for
 * attributing long tasks that are reported after the fact). */
interface StallSlot extends Stall {
    startedAt: number;
    endedAt: number;
}

function emptyStall(): StallSlot {
    return {
        ms: 0, atMs: 0, tickerMs: 0, displayStepMs: 0, renderMs: 0,
        applyMs: 0, longTaskMs: 0, ships: 0, projectiles: 0, missiles: 0,
        beams: 0,
        entities: 0, onScreenEntities: 0, particles: 0,
        startedAt: 0, endedAt: 0,
    };
}

const COUNT_KEYS = ENTITY_COUNT_KEYS;
const INDEX = Object.fromEntries(
    COUNT_KEYS.map((key, i) => [key, i])) as Record<keyof EntityCounts, number>;

/** The measured part of a sample: everything but its identity and
 * context, which perf_telemetry.ts adds. */
export type MeasuredSample = Pick<PerfSample,
    'windowMs' | 'spaceMs' | 'landedMs' | 'transitMs' | 'hiddenMs'
    | 'frames' | 'main' | 'longTasks' | 'heap' | 'counts' | 'stalls'>
    & {
        /** The main-thread half of PerfSample.sim (the worker's half is
         * asked of the bridge); null with no pump in the window. */
        pump: {
            pumps: number, ticks: number, tickRate: number,
            roundTripMeanMs: number, roundTripMaxMs: number,
            stepsPerPumpMean: number, stepsPerPumpMax: number,
            stepReturnMsPerStep: number | null,
            stepReturnMaxMsPerStep: number | null,
            stepReturnMaxBatchMs: number | null,
            behindMeanTicks: number, behindMaxTicks: number,
        } | null,
    };

export class PerfWindow {
    private startedAt = 0;
    // Frames.
    private readonly times: Float32Array;
    private readonly scratch: Float32Array;
    private kept = 0;
    private frames = 0;
    private frameSum = 0;
    private worst = 0;
    private over100 = 0;
    private over1000 = 0;
    private readonly hist = new Uint32Array(FRAME_HISTOGRAM_BUCKETS);
    private readonly phaseMs = { space: 0, landed: 0, transit: 0 };
    private hiddenMs = 0;
    // The main thread's split, per ticker frame.
    private splitFrames = 0;
    private tickerSum = 0;
    private tickerMax = 0;
    private displaySum = 0;
    private displayMax = 0;
    private renderSum = 0;
    private renderMax = 0;
    private otherSum = 0;
    private otherMax = 0;
    /** The last ticker frame's split: the work before the NEXT gap. */
    private lastTicker = 0;
    private lastDisplay = 0;
    private lastRender = 0;
    // State apply (off the ticker).
    private applyCalls = 0;
    private applySum = 0;
    private applyMax = 0;
    private applySinceFrame = 0;
    // Gaps between landed snapshots (kept across windows: a gap may
    // straddle a window boundary).
    private lastApplyAt: number | undefined;
    private lastApplySource: unknown;
    private gaps = 0;
    private gapSum = 0;
    private gapMax = 0;
    private gapsOver500 = 0;
    // The heartbeat's drawless ticker updates.
    private heartbeats = 0;
    // Long tasks.
    private longTaskCount = 0;
    private longTaskSum = 0;
    private longTaskMax = 0;
    // Heap.
    private heapReadings = 0;
    private heapLast = 0;
    private heapMin = 0;
    private heapMax = 0;
    private heapDrops = 0;
    // The simulation pump, as the main thread sees it.
    private pumps = 0;
    private pumpTicks = 0;
    private pumpRttSum = 0;
    private pumpRttMax = 0;
    private pumpStepsMax = 0;
    private returnedSteps = 0;
    private returnedMs = 0;
    private returnedMaxPerStep = 0;
    private returnedMaxBatch = 0;
    private behindReports = 0;
    private behindSum = 0;
    private behindMax = -Infinity;
    // Entity counts.
    private countSamples = 0;
    private readonly countSum = new Float64Array(COUNT_KEYS.length);
    private readonly countMax = new Float64Array(COUNT_KEYS.length);
    /** The latest count, for stall context (kept across windows). */
    private readonly lastCounts = new Float64Array(COUNT_KEYS.length);
    private particlesSpawned = 0;
    // Stalls: the MAX_STALLS_PER_SAMPLE worst, overwritten in place.
    private readonly stalls: StallSlot[] = [];
    private stallCount = 0;

    constructor(now: number, capacity = FRAME_RING_CAPACITY) {
        this.times = new Float32Array(capacity);
        this.scratch = new Float32Array(capacity);
        for (let i = 0; i < MAX_STALLS_PER_SAMPLE; i++) {
            this.stalls.push(emptyStall());
        }
        this.reset(now);
    }

    /** When the window began. */
    get start(): number {
        return this.startedAt;
    }

    /** Frames counted so far. */
    get frameCount(): number {
        return this.frames;
    }

    /** Stalls counted so far (at most MAX_STALLS_PER_SAMPLE are kept). */
    get stallsSeen(): number {
        return this.stallCount;
    }

    /** Wall ms spent in each phase so far (hidden time excluded). */
    phaseTime(phase: PerfPhase): number {
        return this.phaseMs[phase];
    }

    /** Starts a fresh window at `now`. The last entity count is kept: it
     * is still the best description of the world for the next stall. */
    reset(now: number): void {
        this.startedAt = now;
        this.kept = 0;
        this.frames = 0;
        this.frameSum = 0;
        this.worst = 0;
        this.over100 = 0;
        this.over1000 = 0;
        this.hist.fill(0);
        this.phaseMs.space = 0;
        this.phaseMs.landed = 0;
        this.phaseMs.transit = 0;
        this.hiddenMs = 0;
        this.splitFrames = 0;
        this.tickerSum = this.tickerMax = 0;
        this.displaySum = this.displayMax = 0;
        this.renderSum = this.renderMax = 0;
        this.otherSum = this.otherMax = 0;
        this.applyCalls = this.applySum = this.applyMax = 0;
        this.gaps = this.gapSum = this.gapMax = this.gapsOver500 = 0;
        this.heartbeats = 0;
        this.longTaskCount = this.longTaskSum = this.longTaskMax = 0;
        this.heapReadings = 0;
        this.heapDrops = 0;
        this.pumps = this.pumpTicks = 0;
        this.pumpRttSum = this.pumpRttMax = 0;
        this.pumpStepsMax = 0;
        this.returnedSteps = this.returnedMs = 0;
        this.returnedMaxPerStep = this.returnedMaxBatch = 0;
        this.behindReports = this.behindSum = 0;
        this.behindMax = -Infinity;
        this.countSamples = 0;
        this.countSum.fill(0);
        this.countMax.fill(0);
        this.particlesSpawned = 0;
        this.stallCount = 0;
    }

    /**
     * One frame interval, measured at the top of the frame that ended it
     * (`endedAt`). The work that explains a long one is the PREVIOUS
     * ticker frame's (noteTicker) plus the simulation frames applied in
     * between (noteApply). Hidden-tab frames count toward hiddenMs only:
     * a background tab's timers say nothing about the game.
     */
    addFrame(intervalMs: number, endedAt: number, phase: PerfPhase,
        hidden: boolean): void {
        const applied = this.applySinceFrame;
        this.applySinceFrame = 0;
        if (!(intervalMs >= 0)) {
            return;
        }
        if (hidden) {
            this.hiddenMs += intervalMs;
            return;
        }
        this.phaseMs[phase] += intervalMs;
        if (this.kept < this.times.length) {
            this.times[this.kept++] = intervalMs;
        }
        this.frames++;
        this.frameSum += intervalMs;
        if (intervalMs > this.worst) {
            this.worst = intervalMs;
        }
        if (intervalMs > 100) {
            this.over100++;
        }
        if (intervalMs > 1000) {
            this.over1000++;
        }
        this.hist[histogramBucket(intervalMs)]++;
        if (intervalMs > STALL_MS) {
            this.recordStall(intervalMs, endedAt, applied);
        }
    }

    private recordStall(ms: number, endedAt: number, applied: number): void {
        this.stallCount++;
        // A free slot, or else the mildest stall kept, if this is worse.
        let slot: StallSlot | undefined;
        const used = Math.min(this.stallCount - 1, this.stalls.length);
        if (used < this.stalls.length) {
            slot = this.stalls[used];
        } else {
            let mildest = this.stalls[0];
            for (const kept of this.stalls) {
                if (kept.ms < mildest.ms) {
                    mildest = kept;
                }
            }
            if (mildest.ms >= ms) {
                return;
            }
            slot = mildest;
        }
        slot.ms = ms;
        slot.startedAt = endedAt - ms;
        slot.endedAt = endedAt;
        slot.atMs = endedAt - this.startedAt;
        slot.tickerMs = this.lastTicker;
        slot.displayStepMs = this.lastDisplay;
        slot.renderMs = this.lastRender;
        slot.applyMs = applied;
        slot.longTaskMs = 0;
        const counts = this.lastCounts;
        slot.ships = counts[INDEX.ships];
        slot.projectiles = counts[INDEX.projectiles];
        slot.missiles = counts[INDEX.missiles];
        slot.beams = counts[INDEX.beams];
        slot.entities = counts[INDEX.entities];
        slot.onScreenEntities = counts[INDEX.onScreenEntities];
        slot.particles = counts[INDEX.particles];
    }

    /** How many stall slots are in use. */
    private get stallsKept(): number {
        return Math.min(this.stallCount, this.stalls.length);
    }

    /**
     * One ticker frame's work: all of it, the display world's step, and
     * the render. The rest of the ticker's time is "other".
     */
    noteTicker(tickerMs: number, displayStepMs: number,
        renderMs: number): void {
        const other = Math.max(0, tickerMs - displayStepMs - renderMs);
        this.splitFrames++;
        this.tickerSum += tickerMs;
        this.displaySum += displayStepMs;
        this.renderSum += renderMs;
        this.otherSum += other;
        if (tickerMs > this.tickerMax) { this.tickerMax = tickerMs; }
        if (displayStepMs > this.displayMax) { this.displayMax = displayStepMs; }
        if (renderMs > this.renderMax) { this.renderMax = renderMs; }
        if (other > this.otherMax) { this.otherMax = other; }
        this.lastTicker = tickerMs;
        this.lastDisplay = displayStepMs;
        this.lastRender = renderMs;
    }

    /**
     * One simulation frame applied to the display world, at `at`, from
     * `source` (the live system: a gap is only measured between two
     * snapshots of the same one). `hidden` applies are not gaps' ends (a
     * background tab's pump runs on the heartbeat's schedule).
     */
    noteApply(ms: number, at?: number, source?: unknown,
        hidden = false): void {
        if (at !== undefined) {
            if (!hidden && this.lastApplyAt !== undefined
                && source === this.lastApplySource) {
                const gap = at - this.lastApplyAt;
                this.gaps++;
                this.gapSum += gap;
                if (gap > this.gapMax) {
                    this.gapMax = gap;
                }
                if (gap > SNAPSHOT_GAP_STALE_MS) {
                    this.gapsOver500++;
                }
            }
            this.lastApplyAt = hidden ? undefined : at;
            this.lastApplySource = source;
        }
        this.applyCalls++;
        this.applySum += ms;
        this.applySinceFrame += ms;
        if (ms > this.applyMax) {
            this.applyMax = ms;
        }
    }

    /**
     * A long task (PerformanceObserver), reported after it ran. Its
     * overlap with any stall kept in this window is added to that stall.
     */
    noteLongTask(startTime: number, duration: number): void {
        this.longTaskCount++;
        this.longTaskSum += duration;
        if (duration > this.longTaskMax) {
            this.longTaskMax = duration;
        }
        const end = startTime + duration;
        for (let i = 0; i < this.stallsKept; i++) {
            const stall = this.stalls[i];
            const overlap = Math.min(end, stall.endedAt)
                - Math.max(startTime, stall.startedAt);
            if (overlap > 0) {
                stall.longTaskMs += overlap;
            }
        }
    }

    /** A JS heap reading (MB). */
    noteHeap(usedMB: number): void {
        if (this.heapReadings === 0) {
            this.heapMin = this.heapMax = usedMB;
        } else {
            if (this.heapLast - usedMB > HEAP_DROP_MB) {
                this.heapDrops++;
            }
            this.heapMin = Math.min(this.heapMin, usedMB);
            this.heapMax = Math.max(this.heapMax, usedMB);
        }
        this.heapLast = usedMB;
        this.heapReadings++;
    }

    /** One ticker update the heartbeat drove (no draw, not a frame). */
    noteHeartbeat(): void {
        this.heartbeats++;
    }

    /**
     * One simulation pump round trip (step + snapshot) that stepped
     * `ticks`, the drift behind the room's clock it reported, and the
     * worker's own ms for the batch (bridge.step's return), if it said.
     */
    notePump(roundTripMs: number, ticks: number,
        behindTicks: number | undefined, workerBatchMs?: number): void {
        this.pumps++;
        this.pumpTicks += ticks;
        this.pumpRttSum += roundTripMs;
        if (roundTripMs > this.pumpRttMax) {
            this.pumpRttMax = roundTripMs;
        }
        if (ticks > this.pumpStepsMax) {
            this.pumpStepsMax = ticks;
        }
        if (workerBatchMs !== undefined && workerBatchMs >= 0 && ticks > 0) {
            this.returnedSteps += ticks;
            this.returnedMs += workerBatchMs;
            const perStep = workerBatchMs / ticks;
            if (perStep > this.returnedMaxPerStep) {
                this.returnedMaxPerStep = perStep;
            }
            if (workerBatchMs > this.returnedMaxBatch) {
                this.returnedMaxBatch = workerBatchMs;
            }
        }
        if (behindTicks !== undefined && Number.isFinite(behindTicks)) {
            this.behindReports++;
            this.behindSum += behindTicks;
            if (behindTicks > this.behindMax) {
                this.behindMax = behindTicks;
            }
        }
    }

    /** One entity count, in ENTITY_COUNT_KEYS order. */
    noteCounts(counts: ArrayLike<number>): void {
        this.countSamples++;
        for (let i = 0; i < COUNT_KEYS.length; i++) {
            const value = counts[i];
            this.countSum[i] += value;
            if (value > this.countMax[i]) {
                this.countMax[i] = value;
            }
            this.lastCounts[i] = value;
        }
    }

    /** GPU particles spawned since the previous note. */
    noteParticlesSpawned(spawned: number): void {
        if (spawned > 0) {
            this.particlesSpawned += spawned;
        }
    }

    /** Visible seconds of frames (at least a millisecond). */
    private visibleSeconds(): number {
        return Math.max(1e-3, (this.phaseMs.space + this.phaseMs.landed
            + this.phaseMs.transit) / 1000);
    }

    /** The frame-time section of the sample. */
    frameStats(): FrameStats {
        const n = this.kept;
        const sorted = this.scratch.subarray(0, n);
        sorted.set(this.times.subarray(0, n));
        sorted.sort();
        return {
            count: this.frames,
            meanMs: round1(this.frames > 0 ? this.frameSum / this.frames : 0),
            p50Ms: round1(nearestRank(sorted, n, 0.5)),
            p95Ms: round1(nearestRank(sorted, n, 0.95)),
            p99Ms: round1(nearestRank(sorted, n, 0.99)),
            worstMs: round1(this.worst),
            over100: this.over100,
            over1000: this.over1000,
            rafPerSecond: round1(this.frames / this.visibleSeconds()),
            heartbeatUpdates: this.heartbeats,
            heartbeatPerSecond: round1(this.heartbeats
                / this.visibleSeconds()),
            hist: Array.from(this.hist),
        };
    }

    /**
     * The window as the sample's measured sections, at `now`.
     * `longTasksSupported` / `heapSupported` say whether a missing
     * reading means "none" (0) or "this browser cannot say" (null).
     */
    summarize(now: number, longTasksSupported: boolean): MeasuredSample {
        const perFrame = (sum: number) =>
            round1(this.splitFrames > 0 ? sum / this.splitFrames : 0);
        const counts = this.countSamples > 0 ? {
            samples: this.countSamples,
            mean: this.countsRecord(i =>
                round1(this.countSum[i] / this.countSamples)),
            max: this.countsRecord(i => this.countMax[i]),
            particlesSpawned: Math.round(this.particlesSpawned),
        } : null;
        const stalls: Stall[] = [];
        for (let i = 0; i < this.stallsKept; i++) {
            const { startedAt: _s, endedAt: _e, ...stall } = this.stalls[i];
            stalls.push({
                ...stall,
                ms: round1(stall.ms), atMs: Math.round(stall.atMs),
                tickerMs: round1(stall.tickerMs),
                displayStepMs: round1(stall.displayStepMs),
                renderMs: round1(stall.renderMs),
                applyMs: round1(stall.applyMs),
                longTaskMs: round1(stall.longTaskMs),
            });
        }
        stalls.sort((a, b) => b.ms - a.ms);
        return {
            windowMs: Math.round(Math.max(0, now - this.startedAt)),
            spaceMs: Math.round(this.phaseMs.space),
            landedMs: Math.round(this.phaseMs.landed),
            transitMs: Math.round(this.phaseMs.transit),
            hiddenMs: Math.round(this.hiddenMs),
            frames: this.frameStats(),
            main: {
                tickerMeanMs: perFrame(this.tickerSum),
                tickerMaxMs: round1(this.tickerMax),
                displayStepMeanMs: perFrame(this.displaySum),
                displayStepMaxMs: round1(this.displayMax),
                renderMeanMs: perFrame(this.renderSum),
                renderMaxMs: round1(this.renderMax),
                otherMeanMs: perFrame(this.otherSum),
                otherMaxMs: round1(this.otherMax),
                applyCalls: this.applyCalls,
                applyMeanMs: round1(this.applyCalls > 0
                    ? this.applySum / this.applyCalls : 0),
                applyMaxMs: round1(this.applyMax),
                snapshotGapMeanMs: round1(this.gaps > 0
                    ? this.gapSum / this.gaps : 0),
                snapshotGapMaxMs: round1(this.gapMax),
                snapshotGapsOver500: this.gapsOver500,
            },
            longTasks: longTasksSupported ? {
                count: this.longTaskCount,
                totalMs: round1(this.longTaskSum),
                maxMs: round1(this.longTaskMax),
            } : null,
            heap: this.heapReadings > 0 ? {
                usedMB: round1(this.heapLast),
                minMB: round1(this.heapMin),
                maxMB: round1(this.heapMax),
                drops: this.heapDrops,
            } : null,
            pump: this.pumps > 0 ? {
                pumps: this.pumps,
                ticks: this.pumpTicks,
                tickRate: round1(this.pumpTicks
                    / Math.max(1e-3, (now - this.startedAt) / 1000)),
                roundTripMeanMs: round1(this.pumpRttSum / this.pumps),
                roundTripMaxMs: round1(this.pumpRttMax),
                stepsPerPumpMean: round1(this.pumpTicks / this.pumps),
                stepsPerPumpMax: this.pumpStepsMax,
                stepReturnMsPerStep: this.returnedSteps > 0
                    ? round1(this.returnedMs / this.returnedSteps) : null,
                stepReturnMaxMsPerStep: this.returnedSteps > 0
                    ? round1(this.returnedMaxPerStep) : null,
                stepReturnMaxBatchMs: this.returnedSteps > 0
                    ? round1(this.returnedMaxBatch) : null,
                behindMeanTicks: this.behindReports > 0
                    ? round1(this.behindSum / this.behindReports) : 0,
                behindMaxTicks: Number.isFinite(this.behindMax)
                    ? round1(this.behindMax) : 0,
            } : null,
            counts,
            stalls,
        };
    }

    private countsRecord(value: (index: number) => number): EntityCounts {
        const record = {} as EntityCounts;
        for (let i = 0; i < COUNT_KEYS.length; i++) {
            record[COUNT_KEYS[i]] = value(i);
        }
        return record;
    }
}
