/**
 * ============================================================================
 * The performance stats report
 * ============================================================================
 *
 * Reads what the perf_stats route stored (server/perf_stats_route.ts) —
 * the local `perf_stats/<date>.jsonl` files, or a Cloud Logging export
 * (`gcloud logging read ... --format=json`) — and answers, per build and
 * per session: how the frame rate was distributed, the worst stalls and
 * what was on screen during them, how fast the simulation ran, and how
 * frame time scales with the number of entities.
 *
 * Pure: text in, text (or an aggregate object) out. The command is
 * scripts/perf_stats_report.mjs; docs/perf_stats.md shows its output.
 */
import { isRight } from 'fp-ts/lib/Either.js';
import {
    FRAME_HISTOGRAM_BOUNDS_MS, FRAME_HISTOGRAM_BUCKETS, PerfSample,
    PerfSampleType, Stall,
} from '../common/perf_stats.js';
import { PERF_STATS_LOG_TYPE } from './perf_stats_route.js';

/** A sample with the time the server took it. */
export interface ReceivedSample {
    receivedAt: string;
    sample: PerfSample;
}

/** One candidate object from the input: a stored record, a Cloud Logging
 * entry around one, or a bare sample. */
function sampleFrom(value: unknown): ReceivedSample | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const object = value as Record<string, unknown>;
    // A Cloud Logging entry: the record is its jsonPayload.
    if (typeof object.jsonPayload === 'object' && object.jsonPayload) {
        const inner = sampleFrom(object.jsonPayload);
        if (inner && !inner.receivedAt && typeof object.timestamp === 'string') {
            inner.receivedAt = object.timestamp;
        }
        return inner;
    }
    let raw: unknown = object;
    let receivedAt = '';
    if (object.logType === PERF_STATS_LOG_TYPE) {
        raw = object.sample;
        receivedAt = typeof object.receivedAt === 'string'
            ? object.receivedAt : '';
    }
    const decoded = PerfSampleType.decode(raw);
    return isRight(decoded) ? { receivedAt, sample: decoded.right } : undefined;
}

/**
 * Every sample in `text`: JSON lines (a .jsonl), or one JSON array (a
 * `gcloud logging read --format=json` export). Lines that are not
 * samples are skipped and counted.
 */
export function parsePerfStats(text: string):
    { samples: ReceivedSample[], skipped: number } {
    const samples: ReceivedSample[] = [];
    let skipped = 0;
    const take = (value: unknown) => {
        const sample = sampleFrom(value);
        if (sample) {
            samples.push(sample);
        } else {
            skipped++;
        }
    };
    const trimmed = text.trim();
    if (trimmed.startsWith('[')) {
        try {
            const array = JSON.parse(trimmed) as unknown;
            if (Array.isArray(array)) {
                array.forEach(take);
                return { samples, skipped };
            }
        } catch {
            // Fall through: perhaps JSON lines after all.
        }
    }
    for (const line of trimmed.split('\n')) {
        if (!line.trim()) {
            continue;
        }
        try {
            take(JSON.parse(line));
        } catch {
            skipped++;
        }
    }
    return { samples, skipped };
}

// ── Aggregation ───────────────────────────────────────────────────────

/** Frame statistics merged over many samples. */
export interface FrameSummary {
    samples: number;
    frames: number;
    /** Seconds of counted (visible) frames. */
    seconds: number;
    meanFps: number;
    meanFrameMs: number;
    /** From the merged histogram: the bucket bound the quantile falls
     * under ("<= 17.5 ms"); Infinity past the last bound. */
    p50BucketMs: number;
    p95BucketMs: number;
    p99BucketMs: number;
    /** Merged histogram, fraction of frames per bucket. */
    histogram: number[];
    over100: number;
    over1000: number;
    /** Stalls (> 100 ms) per minute of play. */
    stallsPerMinute: number;
    worstMs: number;
    /** Drawless heartbeat ticker updates per visible second. */
    heartbeatPerSecond: number;
    /** Landed-snapshot gaps over 500 ms (the picture froze), per minute,
     * and the longest gap. */
    snapshotGapsOver500: number;
    snapshotGapsPerMinute: number;
    snapshotGapMaxMs: number;
}

export function summarizeFrames(samples: PerfSample[]): FrameSummary {
    const hist = new Array<number>(FRAME_HISTOGRAM_BUCKETS).fill(0);
    let frames = 0;
    let totalMs = 0;
    let over100 = 0;
    let over1000 = 0;
    let worst = 0;
    let heartbeats = 0;
    let visibleMs = 0;
    let gaps = 0;
    let gapMax = 0;
    for (const s of samples) {
        heartbeats += s.frames.heartbeatUpdates;
        visibleMs += s.spaceMs + s.landedMs + s.transitMs;
        gaps += s.main.snapshotGapsOver500;
        gapMax = Math.max(gapMax, s.main.snapshotGapMaxMs);
        frames += s.frames.count;
        totalMs += s.frames.count * s.frames.meanMs;
        over100 += s.frames.over100;
        over1000 += s.frames.over1000;
        worst = Math.max(worst, s.frames.worstMs);
        s.frames.hist.forEach((n, i) => { hist[i] += n; });
    }
    const histTotal = hist.reduce((a, b) => a + b, 0);
    const bucketQuantile = (q: number) => {
        let seen = 0;
        for (let i = 0; i < hist.length; i++) {
            seen += hist[i];
            if (histTotal > 0 && seen >= q * histTotal) {
                return i < FRAME_HISTOGRAM_BOUNDS_MS.length
                    ? FRAME_HISTOGRAM_BOUNDS_MS[i] : Infinity;
            }
        }
        return 0;
    };
    const seconds = totalMs / 1000;
    return {
        samples: samples.length,
        frames,
        seconds,
        meanFps: totalMs > 0 ? frames / seconds : 0,
        meanFrameMs: frames > 0 ? totalMs / frames : 0,
        p50BucketMs: bucketQuantile(0.5),
        p95BucketMs: bucketQuantile(0.95),
        p99BucketMs: bucketQuantile(0.99),
        histogram: hist.map(n => histTotal > 0 ? n / histTotal : 0),
        over100,
        over1000,
        stallsPerMinute: seconds > 0 ? over100 / (seconds / 60) : 0,
        worstMs: worst,
        heartbeatPerSecond: visibleMs > 0 ? heartbeats / (visibleMs / 1000) : 0,
        snapshotGapsOver500: gaps,
        snapshotGapsPerMinute: visibleMs > 0 ? gaps / (visibleMs / 60000) : 0,
        snapshotGapMaxMs: gapMax,
    };
}

/** The simulation, merged over samples that pumped. */
export interface SimSummary {
    samples: number;
    meanTickRate: number;
    minTickRate: number;
    meanRoundTripMs: number;
    maxRoundTripMs: number;
    /** Worker wall ms per tick, tick-weighted. */
    workerTickMs: number;
    workerStepCallMaxMs: number;
    workerSnapshotMs: number;
    /** Steps per pump: mean (tick-weighted) and the largest batch. */
    stepsPerPumpMean: number;
    stepsPerPumpMax: number;
    /** bridge.step's returned worker ms per step (tick-weighted) and the
     * worst batch; 0 when no sample carried it. */
    stepReturnMsPerStep: number;
    stepReturnMaxBatchMs: number;
    /** pacing.behindTicks: mean (pump-weighted) and max. */
    behindMeanTicks: number;
    behindMaxTicks: number;
    rollbacks: number;
    maxRollbackDepth: number;
    events: Record<string, number>;
}

export function summarizeSim(samples: PerfSample[]): SimSummary {
    const sims = samples.filter(s => s.sim !== null);
    let rateSeconds = 0;
    let ticks = 0;
    let minRate = Infinity;
    let rttSum = 0;
    let pumps = 0;
    let rttMax = 0;
    let workerTicks = 0;
    let workerMs = 0;
    let stepMax = 0;
    let snapCalls = 0;
    let snapMs = 0;
    let pumpTicks = 0;
    let stepsMax = 0;
    let returnTicks = 0;
    let returnMs = 0;
    let returnBatchMax = 0;
    let behindSum = 0;
    let behindMax = -Infinity;
    let rollbacks = 0;
    let maxDepth = 0;
    const events: Record<string, number> = {};
    for (const s of sims) {
        const sim = s.sim!;
        const seconds = s.windowMs / 1000;
        rateSeconds += seconds;
        ticks += sim.tickRate * seconds;
        minRate = Math.min(minRate, sim.tickRate);
        rttSum += sim.roundTripMeanMs * sim.pumps;
        pumps += sim.pumps;
        rttMax = Math.max(rttMax, sim.roundTripMaxMs);
        pumpTicks += sim.ticks;
        stepsMax = Math.max(stepsMax, sim.stepsPerPumpMax);
        if (sim.stepReturnMsPerStep !== null) {
            returnTicks += sim.ticks;
            returnMs += sim.stepReturnMsPerStep * sim.ticks;
            returnBatchMax = Math.max(returnBatchMax,
                sim.stepReturnMaxBatchMs ?? 0);
        }
        behindSum += sim.behindMeanTicks * sim.pumps;
        behindMax = Math.max(behindMax, sim.behindMaxTicks);
        if (sim.worker) {
            workerTicks += sim.worker.ticks;
            workerMs += sim.worker.tickMeanMs * sim.worker.ticks;
            stepMax = Math.max(stepMax, sim.worker.stepCallMaxMs);
            snapCalls += sim.worker.snapshotCalls;
            snapMs += sim.worker.snapshotMeanMs * sim.worker.snapshotCalls;
        }
    }
    for (const s of samples) {
        if (!s.rollback) {
            continue;
        }
        rollbacks += s.rollback.rollbacks;
        maxDepth = Math.max(maxDepth, s.rollback.maxDepth);
        for (const [event, n] of Object.entries(s.rollback.events)) {
            events[event] = (events[event] ?? 0) + n;
        }
    }
    return {
        samples: sims.length,
        meanTickRate: rateSeconds > 0 ? ticks / rateSeconds : 0,
        minTickRate: Number.isFinite(minRate) ? minRate : 0,
        meanRoundTripMs: pumps > 0 ? rttSum / pumps : 0,
        maxRoundTripMs: rttMax,
        workerTickMs: workerTicks > 0 ? workerMs / workerTicks : 0,
        workerStepCallMaxMs: stepMax,
        workerSnapshotMs: snapCalls > 0 ? snapMs / snapCalls : 0,
        stepsPerPumpMean: pumps > 0 ? pumpTicks / pumps : 0,
        stepsPerPumpMax: stepsMax,
        stepReturnMsPerStep: returnTicks > 0 ? returnMs / returnTicks : 0,
        stepReturnMaxBatchMs: returnBatchMax,
        behindMeanTicks: pumps > 0 ? behindSum / pumps : 0,
        behindMaxTicks: Number.isFinite(behindMax) ? behindMax : 0,
        rollbacks,
        maxRollbackDepth: maxDepth,
        events,
    };
}

/** A stall with where it happened. */
export interface LocatedStall extends Stall {
    sid: string;
    build: string;
    system: string | null;
    receivedAt: string;
}

export function worstStalls(samples: ReceivedSample[],
    limit: number): LocatedStall[] {
    const all: LocatedStall[] = [];
    for (const { sample, receivedAt } of samples) {
        for (const stall of sample.stalls) {
            all.push({
                ...stall, sid: sample.sid, build: sample.build,
                system: sample.system, receivedAt,
            });
        }
    }
    return all.sort((a, b) => b.ms - a.ms).slice(0, limit);
}

/** Entity-count bins for the scaling table (upper bounds). */
export const ENTITY_BINS = [25, 50, 100, 200, 400, 800, Infinity];

export interface ScalingRow {
    /** The bin's range of the mean count. */
    from: number;
    to: number;
    samples: number;
    frames: number;
    meanFrameMs: number;
    meanP95Ms: number;
    stallsPer1000Frames: number;
    renderMs: number;
    displayStepMs: number;
    applyMs: number;
    workerTickMs: number;
}

/** A least-squares line y = intercept + slope * x, and Pearson's r. */
export interface Fit {
    n: number;
    slope: number;
    intercept: number;
    r: number;
}

export function linearFit(xs: number[], ys: number[]): Fit {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) {
        return { n, slope: 0, intercept: n === 1 ? ys[0] : 0, r: 0 };
    }
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    const mx = sx / n, my = sy / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    return {
        n, slope, intercept: my - slope * mx,
        r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0,
    };
}

/** What a sample is binned and fitted by. */
export type ScalingKey = 'onScreenEntities' | 'entities' | 'onScreenProjectiles'
    | 'ships' | 'missiles';

/** In-space samples with counts, binned by the window's mean `key`. */
export function scalingTable(samples: PerfSample[],
    key: ScalingKey): ScalingRow[] {
    const counted = samples.filter(s => s.counts && s.frames.count > 0);
    const rows: ScalingRow[] = [];
    let from = 0;
    for (const to of ENTITY_BINS) {
        const inBin = counted.filter(s => {
            const value = s.counts!.mean[key];
            return value >= from && value < to;
        });
        if (inBin.length > 0) {
            const frames = inBin.reduce((a, s) => a + s.frames.count, 0);
            const weighted = (value: (s: PerfSample) => number) =>
                inBin.reduce((a, s) => a + value(s) * s.frames.count, 0)
                / Math.max(1, frames);
            const workerSamples = inBin.filter(s => s.sim?.worker);
            const workerTicks = workerSamples.reduce(
                (a, s) => a + s.sim!.worker!.ticks, 0);
            rows.push({
                from, to, samples: inBin.length, frames,
                meanFrameMs: weighted(s => s.frames.meanMs),
                meanP95Ms: inBin.reduce((a, s) => a + s.frames.p95Ms, 0)
                    / inBin.length,
                stallsPer1000Frames: 1000 * inBin.reduce(
                    (a, s) => a + s.frames.over100, 0) / Math.max(1, frames),
                renderMs: weighted(s => s.main.renderMeanMs),
                displayStepMs: weighted(s => s.main.displayStepMeanMs),
                applyMs: inBin.reduce((a, s) => a + s.main.applyMeanMs
                    * s.main.applyCalls, 0) / Math.max(1, frames),
                workerTickMs: workerTicks > 0 ? workerSamples.reduce(
                    (a, s) => a + s.sim!.worker!.tickMeanMs
                        * s.sim!.worker!.ticks, 0) / workerTicks : 0,
            });
        }
        from = to;
    }
    return rows;
}

/** The fits the report prints: frame / render / worker cost per entity. */
export function scalingFits(samples: PerfSample[]) {
    const counted = samples.filter(s => s.counts && s.frames.count > 0);
    const xOn = counted.map(s => s.counts!.mean.onScreenEntities);
    const xAll = counted.map(s => s.counts!.mean.entities);
    const withWorker = counted.filter(s => s.sim?.worker);
    const withReturn = counted.filter(
        s => s.sim?.stepReturnMsPerStep !== null && s.sim !== null);
    return {
        frameMsByOnScreen: linearFit(xOn, counted.map(s => s.frames.meanMs)),
        p95MsByOnScreen: linearFit(xOn, counted.map(s => s.frames.p95Ms)),
        renderMsByOnScreen: linearFit(xOn,
            counted.map(s => s.main.renderMeanMs)),
        displayStepMsByEntities: linearFit(xAll,
            counted.map(s => s.main.displayStepMeanMs)),
        workerTickMsByEntities: linearFit(
            withWorker.map(s => s.counts!.mean.entities),
            withWorker.map(s => s.sim!.worker!.tickMeanMs)),
        /** The proximity fuse's shape: missiles x collidables. */
        stepMsByMissileCollidables: linearFit(
            withReturn.map(s => s.counts!.mean.missiles
                * (s.counts!.mean.ships + s.counts!.mean.asteroids)),
            withReturn.map(s => s.sim!.stepReturnMsPerStep!)),
    };
}

/** "Chrome 131 / macOS" from a user agent. */
export function shortUserAgent(ua: string): string {
    const browser =
        /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`
            : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
                : /HeadlessChrome\/(\d+)/.exec(ua)
                    ? `HeadlessChrome ${/HeadlessChrome\/(\d+)/.exec(ua)![1]}`
                    : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}`
                        : /Version\/(\d+)[^ ]* .*Safari/.exec(ua)
                            ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}`
                            : 'unknown browser';
    const os = /Android/.test(ua) ? 'Android'
        : /iPhone|iPad/.test(ua) ? 'iOS'
            : /CrOS/.test(ua) ? 'ChromeOS'
                : /Mac OS X/.test(ua) ? 'macOS'
                    : /Windows/.test(ua) ? 'Windows'
                        : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
    return `${browser} / ${os}`;
}

export interface SessionSummary {
    sid: string;
    build: string;
    firstAt: string;
    lastAt: string;
    browser: string;
    renderer: string | null;
    devicePixelRatio: number;
    canvas: string;
    cores: number | null;
    memoryGB: number | null;
    systems: string[];
    minutes: number;
    frames: FrameSummary;
    sim: SimSummary;
    maxEntities: number;
    maxOnScreen: number;
    maxProjectiles: number;
    maxMissiles: number;
}

export interface PerfReport {
    samples: number;
    skipped: number;
    sessions: number;
    from: string;
    to: string;
    builds: {
        build: string, sessions: number, frames: FrameSummary,
        sim: SimSummary,
    }[];
    perSession: SessionSummary[];
    stalls: LocatedStall[];
    scaling: {
        byOnScreen: ScalingRow[],
        byEntities: ScalingRow[],
        byMissiles: ScalingRow[],
        fits: ReturnType<typeof scalingFits>,
    };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const k = key(item);
        const group = groups.get(k);
        if (group) {
            group.push(item);
        } else {
            groups.set(k, [item]);
        }
    }
    return groups;
}

export function buildPerfReport(received: ReceivedSample[], skipped = 0,
    stallLimit = 15): PerfReport {
    const ordered = [...received].sort((a, b) =>
        a.receivedAt.localeCompare(b.receivedAt)
        || a.sample.sid.localeCompare(b.sample.sid)
        || a.sample.seq - b.sample.seq);
    const samples = ordered.map(r => r.sample);
    const bySession = groupBy(ordered, r => r.sample.sid);
    const perSession: SessionSummary[] = [];
    for (const [sid, rows] of bySession) {
        const ss = rows.map(r => r.sample);
        const last = ss[ss.length - 1];
        const maxOf = (pick: (s: PerfSample) => number) =>
            Math.max(0, ...ss.map(pick));
        perSession.push({
            sid, build: last.build,
            firstAt: rows[0].receivedAt, lastAt: rows[rows.length - 1].receivedAt,
            browser: shortUserAgent(last.env.userAgent),
            renderer: last.env.renderer,
            devicePixelRatio: last.env.devicePixelRatio,
            canvas: `${last.env.canvasWidth}x${last.env.canvasHeight}`,
            cores: last.env.hardwareConcurrency,
            memoryGB: last.env.deviceMemoryGB,
            systems: [...new Set(ss.map(s => s.system)
                .filter((s): s is string => s !== null))],
            minutes: ss.reduce((a, s) => a + s.windowMs, 0) / 60000,
            frames: summarizeFrames(ss),
            sim: summarizeSim(ss),
            maxEntities: maxOf(s => s.counts?.max.entities ?? 0),
            maxOnScreen: maxOf(s => s.counts?.max.onScreenEntities ?? 0),
            maxProjectiles: maxOf(s => s.counts?.max.projectiles ?? 0),
            maxMissiles: maxOf(s => s.counts?.max.missiles ?? 0),
        });
    }
    const builds = [...groupBy(samples, s => s.build)].map(([build, ss]) => ({
        build,
        sessions: new Set(ss.map(s => s.sid)).size,
        frames: summarizeFrames(ss),
        sim: summarizeSim(ss),
    }));
    return {
        samples: samples.length,
        skipped,
        sessions: bySession.size,
        from: ordered[0]?.receivedAt ?? '',
        to: ordered[ordered.length - 1]?.receivedAt ?? '',
        builds,
        perSession,
        stalls: worstStalls(ordered, stallLimit),
        scaling: {
            byOnScreen: scalingTable(samples, 'onScreenEntities'),
            byEntities: scalingTable(samples, 'entities'),
            byMissiles: scalingTable(samples, 'missiles'),
            fits: scalingFits(samples),
        },
    };
}

// ── Text ──────────────────────────────────────────────────────────────

function fixed(value: number, digits = 1): string {
    return Number.isFinite(value) ? value.toFixed(digits) : 'inf';
}

function bound(ms: number): string {
    return Number.isFinite(ms) ? `<=${ms}` : `>${FRAME_HISTOGRAM_BOUNDS_MS[
        FRAME_HISTOGRAM_BOUNDS_MS.length - 1]}`;
}

function table(header: string[], rows: string[][]): string {
    const widths = header.map((h, i) => Math.max(h.length,
        ...rows.map(r => (r[i] ?? '').length)));
    const line = (cells: string[]) => cells.map((c, i) =>
        i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])).join('  ');
    return [line(header), line(widths.map(w => '-'.repeat(w))),
        ...rows.map(line)].join('\n');
}

function histogramLine(frames: FrameSummary): string {
    const labels = [...FRAME_HISTOGRAM_BOUNDS_MS.map(b => `<=${b}`),
        `>${FRAME_HISTOGRAM_BOUNDS_MS[FRAME_HISTOGRAM_BOUNDS_MS.length - 1]}`];
    return frames.histogram.map((f, i) => `${labels[i]}ms ${fixed(f * 100)}%`)
        .filter((_, i) => frames.histogram[i] > 0).join(' | ');
}

/** Fewer samples than this, and a fit says nothing. */
export const MIN_FIT_SAMPLES = 5;

function fitLine(name: string, fit: Fit, per = 100,
    unit = 'per 100'): string {
    if (fit.n < MIN_FIT_SAMPLES) {
        return `  ${name.padEnd(40)} (too few samples: ${fit.n})`;
    }
    return `  ${name.padEnd(40)} ${fixed(fit.slope * per, 2).padStart(7)} `
        + `ms ${unit}   (at 0: ${fixed(fit.intercept, 1)} ms, `
        + `r=${fixed(fit.r, 2)}, n=${fit.n})`;
}

/**
 * The part of a stall no measured main-thread work covers: the gap less
 * the larger of (the ticker work before it + the state applies in it) and
 * the long tasks that overlapped it (a long task usually CONTAINS the
 * ticker work, so the two are not added). Large means the time went
 * somewhere the page cannot see: the GPU, the compositor, the browser
 * throttling the page, or a long task the browser does not report.
 */
export function unaccountedMs(stall: Stall): number {
    return Math.max(0, stall.ms
        - Math.max(stall.tickerMs + stall.applyMs, stall.longTaskMs));
}

/** The worker's ms per step: bridge.step's own figure where the samples
 * carry it, else the worker counters' tick mean. */
function stepMs(sim: SimSummary): number {
    return sim.stepReturnMsPerStep > 0 ? sim.stepReturnMsPerStep
        : sim.workerTickMs;
}

export function formatPerfReport(report: PerfReport): string {
    const out: string[] = [];
    out.push(`NovaJS performance stats: ${report.samples} samples, `
        + `${report.sessions} sessions${report.skipped
            ? `, ${report.skipped} lines skipped` : ''}`);
    if (report.samples === 0) {
        return out.join('\n');
    }
    out.push(`${report.from} .. ${report.to}`);

    out.push('', '== Per build');
    out.push(table(
        ['build', 'sessions', 'samples', 'minutes', 'fps', 'p50', 'p95', 'p99',
            '>100ms', '>1s', 'stalls/min', 'worst ms', 'heartbeat/s',
            'gaps>500/min', 'ticks/s', 'ms/step', 'rollbacks'],
        report.builds.map(b => [
            b.build, `${b.sessions}`, `${b.frames.samples}`,
            fixed(b.frames.seconds / 60), fixed(b.frames.meanFps),
            bound(b.frames.p50BucketMs), bound(b.frames.p95BucketMs),
            bound(b.frames.p99BucketMs), `${b.frames.over100}`,
            `${b.frames.over1000}`, fixed(b.frames.stallsPerMinute, 2),
            fixed(b.frames.worstMs, 0), fixed(b.frames.heartbeatPerSecond),
            fixed(b.frames.snapshotGapsPerMinute, 2),
            fixed(b.sim.meanTickRate), fixed(stepMs(b.sim), 2),
            `${b.sim.rollbacks}`,
        ])));
    for (const b of report.builds) {
        out.push(`  ${b.build} frame times: ${histogramLine(b.frames)}`);
    }

    out.push('', '== Per session');
    out.push(table(
        ['session', 'build', 'browser', 'min', 'fps', 'p95', '>100ms', '>1s',
            'worst', 'heartbeat/s', 'max ents', 'max on-scr', 'max proj',
            'max missiles', 'dpr', 'canvas', 'renderer'],
        report.perSession.map(s => [
            s.sid.slice(0, 8), s.build.slice(0, 14), s.browser,
            fixed(s.minutes), fixed(s.frames.meanFps),
            bound(s.frames.p95BucketMs), `${s.frames.over100}`,
            `${s.frames.over1000}`, fixed(s.frames.worstMs, 0),
            fixed(s.frames.heartbeatPerSecond),
            `${s.maxEntities}`, `${s.maxOnScreen}`, `${s.maxProjectiles}`,
            `${s.maxMissiles}`, fixed(s.devicePixelRatio, 2), s.canvas,
            (s.renderer ?? '?').slice(0, 40),
        ])));

    out.push('', '== Simulation per session (ms/step: bridge.step\'s own '
        + 'figure; gaps: time between landed snapshots)');
    out.push(table(
        ['session', 'ticks/s', 'min t/s', 'steps/pump', 'max steps',
            'ms/step', 'worst batch', 'worker tick', 'snapshot', 'behind',
            'max behind', 'gaps>500', 'max gap', 'rollbk', 'max depth'],
        report.perSession.map(s => [
            s.sid.slice(0, 8), fixed(s.sim.meanTickRate),
            fixed(s.sim.minTickRate), fixed(s.sim.stepsPerPumpMean),
            `${s.sim.stepsPerPumpMax}`, fixed(s.sim.stepReturnMsPerStep, 2),
            fixed(s.sim.stepReturnMaxBatchMs, 0),
            fixed(s.sim.workerTickMs, 2), fixed(s.sim.workerSnapshotMs, 2),
            fixed(s.sim.behindMeanTicks), fixed(s.sim.behindMaxTicks),
            `${s.frames.snapshotGapsOver500}`,
            fixed(s.frames.snapshotGapMaxMs, 0), `${s.sim.rollbacks}`,
            `${s.sim.maxRollbackDepth}`,
        ])));

    out.push('', `== Worst stalls (frame intervals over 100 ms; split is `
        + `the ticker work before the gap)`);
    out.push(table(
        ['ms', 'session', 'system', 'ticker', 'display', 'render', 'apply',
            'longtask', 'unaccounted', 'ships', 'proj', 'missiles', 'beams',
            'ents', 'on-scr', 'particles', 'at'],
        report.stalls.map(s => [
            fixed(s.ms, 0), s.sid.slice(0, 8), s.system ?? '-',
            fixed(s.tickerMs), fixed(s.displayStepMs), fixed(s.renderMs),
            fixed(s.applyMs), fixed(s.longTaskMs),
            fixed(unaccountedMs(s)),
            `${s.ships}`, `${s.projectiles}`, `${s.missiles}`, `${s.beams}`,
            `${s.entities}`,
            `${s.onScreenEntities}`, `${s.particles}`,
            s.receivedAt.slice(0, 19),
        ])));

    const scalingRows = (rows: ScalingRow[]) => table(
        ['mean count', 'samples', 'frames', 'frame ms', 'p95 ms',
            'stalls/1k', 'render', 'display', 'apply', 'worker tick'],
        rows.map(r => [
            `${r.from}-${Number.isFinite(r.to) ? r.to : ''}`, `${r.samples}`,
            `${r.frames}`, fixed(r.meanFrameMs), fixed(r.meanP95Ms),
            fixed(r.stallsPer1000Frames), fixed(r.renderMs, 2),
            fixed(r.displayStepMs, 2), fixed(r.applyMs, 2),
            fixed(r.workerTickMs, 2),
        ]));
    out.push('', '== Frame time by entities ON SCREEN (in-space samples, '
        + 'binned by the window\'s mean)');
    out.push(scalingRows(report.scaling.byOnScreen));
    out.push('', '== Frame time by entities IN THE SYSTEM');
    out.push(scalingRows(report.scaling.byEntities));
    out.push('', '== By proximity-fused MISSILES in the system (the '
        + 'worker\'s fuse scan is missiles x collidables)');
    out.push(scalingRows(report.scaling.byMissiles));
    const fits = report.scaling.fits;
    out.push('', '== Linear fits over the in-space samples');
    out.push(fitLine('mean frame ms ~ on-screen', fits.frameMsByOnScreen));
    out.push(fitLine('p95 frame ms ~ on-screen', fits.p95MsByOnScreen));
    out.push(fitLine('render ms ~ on-screen', fits.renderMsByOnScreen));
    out.push(fitLine('display step ms ~ in system',
        fits.displayStepMsByEntities));
    out.push(fitLine('worker ms/tick ~ in system',
        fits.workerTickMsByEntities));
    out.push(fitLine('ms/step ~ missiles x (ships + asteroids)',
        fits.stepMsByMissileCollidables, 10_000, 'per 10k pairs'));
    return out.join('\n');
}
