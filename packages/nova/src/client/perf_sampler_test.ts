import 'jasmine';
import {
    ENTITY_COUNT_KEYS, FRAME_HISTOGRAM_BUCKETS, MAX_STALLS_PER_SAMPLE,
} from '../common/perf_stats.js';
import {
    histogramBucket, nearestRank, PerfWindow, round1,
} from './perf_sampler.js';

/** Counts in ENTITY_COUNT_KEYS order, from a partial record. */
function counts(values: Partial<Record<string, number>>): Float64Array {
    return Float64Array.from(ENTITY_COUNT_KEYS.map(key => values[key] ?? 0));
}

/** Feeds `intervals` as consecutive frames starting at `start`. */
function feed(window: PerfWindow, start: number, intervals: number[],
    phase: 'space' | 'landed' | 'transit' = 'space'): number {
    let now = start;
    for (const interval of intervals) {
        now += interval;
        window.addFrame(interval, now, phase, false);
    }
    return now;
}

describe('perf sampler arithmetic', () => {
    it('nearestRank is the nearest-rank quantile of a sorted prefix', () => {
        const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        expect(nearestRank(sorted, 10, 0.5)).toBe(5);
        expect(nearestRank(sorted, 10, 0.95)).toBe(10);
        expect(nearestRank(sorted, 10, 0.9)).toBe(9);
        expect(nearestRank(sorted, 10, 0)).toBe(1);
        expect(nearestRank(sorted, 4, 1)).toBe(4);
        expect(nearestRank(sorted, 0, 0.5)).toBe(0);
    });

    it('histogramBucket uses inclusive upper bounds and an overflow bucket',
        () => {
            expect(histogramBucket(0)).toBe(0);
            expect(histogramBucket(8.5)).toBe(0);
            expect(histogramBucket(8.6)).toBe(1);
            expect(histogramBucket(16.7)).toBe(2);
            expect(histogramBucket(100)).toBe(6);
            expect(histogramBucket(1000)).toBe(8);
            expect(histogramBucket(3000)).toBe(FRAME_HISTOGRAM_BUCKETS - 1);
        });

    it('round1 keeps one decimal', () => {
        expect(round1(16.6666)).toBe(16.7);
        expect(round1(0.04)).toBe(0);
    });
});

describe('PerfWindow', () => {
    it('summarizes frame times: mean, percentiles, worst, histogram', () => {
        const window = new PerfWindow(0);
        // 98 smooth frames, a 150 ms hitch and a 2 s stall.
        const intervals = [...new Array(98).fill(16), 150, 2000];
        const end = feed(window, 0, intervals);
        const summary = window.summarize(end, true);
        const frames = summary.frames;
        expect(frames.count).toBe(100);
        expect(frames.meanMs).toBe(round1((98 * 16 + 150 + 2000) / 100));
        expect(frames.p50Ms).toBe(16);
        expect(frames.p95Ms).toBe(16);
        expect(frames.p99Ms).toBe(150);
        expect(frames.worstMs).toBe(2000);
        expect(frames.over100).toBe(2);
        expect(frames.over1000).toBe(1);
        expect(frames.hist.length).toBe(FRAME_HISTOGRAM_BUCKETS);
        expect(frames.hist.reduce((a, b) => a + b, 0)).toBe(100);
        expect(frames.hist[histogramBucket(16)]).toBe(98);
        expect(frames.hist[histogramBucket(2000)]).toBe(1);
        expect(summary.windowMs).toBe(end);
        expect(summary.spaceMs).toBe(end);
    });

    it('splits time by phase and leaves hidden frames out', () => {
        const window = new PerfWindow(0);
        let now = feed(window, 0, [16, 16], 'space');
        now = feed(window, now, [20], 'landed');
        now = feed(window, now, [30], 'transit');
        window.addFrame(1000, now + 1000, 'space', true);
        const summary = window.summarize(now + 1000, false);
        expect(summary.spaceMs).toBe(32);
        expect(summary.landedMs).toBe(20);
        expect(summary.transitMs).toBe(30);
        expect(summary.hiddenMs).toBe(1000);
        expect(summary.frames.count).toBe(4);
        expect(summary.frames.worstMs).toBe(30);
        expect(window.phaseTime('space')).toBe(32);
    });

    it('averages the main thread split per ticker frame', () => {
        const window = new PerfWindow(0);
        window.noteTicker(10, 2, 5);
        window.noteTicker(20, 4, 10);
        const main = window.summarize(100, false).main;
        expect(main.tickerMeanMs).toBe(15);
        expect(main.tickerMaxMs).toBe(20);
        expect(main.displayStepMeanMs).toBe(3);
        expect(main.renderMeanMs).toBe(7.5);
        expect(main.otherMeanMs).toBe(4.5);
        expect(main.otherMaxMs).toBe(6);
    });

    it('averages state applies per call', () => {
        const window = new PerfWindow(0);
        window.noteApply(1);
        window.noteApply(3);
        const main = window.summarize(100, false).main;
        expect(main.applyCalls).toBe(2);
        expect(main.applyMeanMs).toBe(2);
        expect(main.applyMaxMs).toBe(3);
    });

    it('reports a stall with the work before it and the world at the time',
        () => {
            const window = new PerfWindow(1000);
            window.noteCounts(counts({
                ships: 12, projectiles: 40, beams: 3, entities: 99,
                onScreenEntities: 50, particles: 512,
            }));
            let now = feed(window, 1000, [16]);
            window.noteTicker(60, 5, 50);
            window.noteApply(7);
            window.noteApply(8);
            now += 400;
            window.addFrame(400, now, 'space', false);
            const [stall] = window.summarize(now, true).stalls;
            expect(stall.ms).toBe(400);
            expect(stall.atMs).toBe(now - 1000);
            expect(stall.tickerMs).toBe(60);
            expect(stall.displayStepMs).toBe(5);
            expect(stall.renderMs).toBe(50);
            // Only the applies in the gap (both landed after the last
            // frame).
            expect(stall.applyMs).toBe(15);
            expect(stall.ships).toBe(12);
            expect(stall.projectiles).toBe(40);
            expect(stall.beams).toBe(3);
            expect(stall.entities).toBe(99);
            expect(stall.onScreenEntities).toBe(50);
            expect(stall.particles).toBe(512);
        });

    it('keeps only the worst stalls, worst first', () => {
        const window = new PerfWindow(0);
        const stallTimes = [110, 900, 120, 130, 140, 150, 160, 170, 180,
            190, 101];
        const end = feed(window, 0, stallTimes);
        const { stalls } = window.summarize(end, false);
        expect(window.stallsSeen).toBe(stallTimes.length);
        expect(stalls.length).toBe(MAX_STALLS_PER_SAMPLE);
        expect(stalls.map(s => s.ms)).toEqual(
            [...stallTimes].sort((a, b) => b - a)
                .slice(0, MAX_STALLS_PER_SAMPLE));
    });

    it('adds overlapping long tasks to the stalls they explain', () => {
        const window = new PerfWindow(0);
        feed(window, 0, [16]);
        window.addFrame(500, 516, 'space', false);
        // Inside the gap (16..516), half inside, and outside it.
        window.noteLongTask(100, 200);
        window.noteLongTask(400, 300);
        window.noteLongTask(600, 80);
        const summary = window.summarize(700, true);
        expect(summary.stalls[0].longTaskMs).toBe(200 + 116);
        expect(summary.longTasks).toEqual({
            count: 3, totalMs: 580, maxMs: 300,
        });
    });

    it('reports long tasks as null where the browser cannot see them', () => {
        const window = new PerfWindow(0);
        feed(window, 0, [16]);
        expect(window.summarize(16, false).longTasks).toBeNull();
    });

    it('counts heap drops as GC hints', () => {
        const window = new PerfWindow(0);
        expect(window.summarize(1, false).heap).toBeNull();
        for (const mb of [100, 110, 120, 90, 95, 93, 140]) {
            window.noteHeap(mb);
        }
        expect(window.summarize(1, false).heap).toEqual({
            usedMB: 140, minMB: 90, maxMB: 140, drops: 1,
        });
    });

    it('sums the pump: tick rate over the window, round trips, drift', () => {
        const window = new PerfWindow(0);
        expect(window.summarize(1000, false).pump).toBeNull();
        for (let i = 0; i < 60; i++) {
            window.notePump(i === 30 ? 40 : 4, 2, i === 10 ? 7 : 1);
        }
        const pump = window.summarize(2000, false).pump!;
        expect(pump.pumps).toBe(60);
        expect(pump.ticks).toBe(120);
        expect(pump.tickRate).toBe(60);
        expect(pump.roundTripMeanMs).toBe(round1((59 * 4 + 40) / 60));
        expect(pump.roundTripMaxMs).toBe(40);
        expect(pump.behindMaxTicks).toBe(7);
    });

    it('averages entity counts and keeps their maxima', () => {
        const window = new PerfWindow(0);
        expect(window.summarize(1, false).counts).toBeNull();
        window.noteCounts(counts({ ships: 10, entities: 100 }));
        window.noteCounts(counts({ ships: 20, entities: 50 }));
        window.noteParticlesSpawned(300);
        window.noteParticlesSpawned(-5);
        const result = window.summarize(1, false).counts!;
        expect(result.samples).toBe(2);
        expect(result.mean.ships).toBe(15);
        expect(result.mean.entities).toBe(75);
        expect(result.max.ships).toBe(20);
        expect(result.max.entities).toBe(100);
        expect(result.particlesSpawned).toBe(300);
    });

    it('starts each window fresh, but keeps the last count for stalls', () => {
        const window = new PerfWindow(0);
        window.noteCounts(counts({ ships: 9 }));
        const end = feed(window, 0, [16, 300]);
        window.noteTicker(10, 1, 5);
        window.noteApply(2);
        window.notePump(3, 1, 0);
        window.noteLongTask(0, 60);
        window.noteHeap(100);
        window.reset(end);
        const empty = window.summarize(end + 10, true);
        expect(empty.frames.count).toBe(0);
        expect(empty.frames.hist.every(n => n === 0)).toBeTrue();
        expect(empty.stalls).toEqual([]);
        expect(empty.main.applyCalls).toBe(0);
        expect(empty.main.tickerMeanMs).toBe(0);
        expect(empty.pump).toBeNull();
        expect(empty.counts).toBeNull();
        expect(empty.heap).toBeNull();
        expect(empty.longTasks).toEqual({ count: 0, totalMs: 0, maxMs: 0 });
        expect(empty.windowMs).toBe(10);
        // The next stall still knows what was on screen.
        window.addFrame(250, end + 250, 'space', false);
        expect(window.summarize(end + 250, true).stalls[0].ships).toBe(9);
    });

    it('caps the percentile ring but still counts every frame', () => {
        const window = new PerfWindow(0, 4);
        feed(window, 0, [10, 10, 10, 10, 50, 50]);
        const frames = window.summarize(140, false).frames;
        expect(frames.count).toBe(6);
        expect(frames.worstMs).toBe(50);
        expect(frames.p99Ms).toBe(10);
        expect(frames.meanMs).toBe(round1(140 / 6));
    });

    it('ignores a negative or NaN interval', () => {
        const window = new PerfWindow(0);
        window.addFrame(-5, 0, 'space', false);
        window.addFrame(NaN, 0, 'space', false);
        expect(window.frameCount).toBe(0);
    });

    it('measures the time between landed snapshots within one system', () => {
        const window = new PerfWindow(0);
        const systemA = {};
        const systemB = {};
        window.noteApply(1, 100, systemA);
        window.noteApply(1, 117, systemA);
        window.noteApply(1, 717, systemA);
        // A new system: no gap across the switch.
        window.noteApply(1, 5000, systemB);
        window.noteApply(1, 5020, systemB);
        // A hidden apply ends no gap and starts none.
        window.noteApply(1, 9000, systemB, true);
        window.noteApply(1, 9600, systemB);
        const main = window.summarize(10000, false).main;
        expect(main.applyCalls).toBe(7);
        expect(main.snapshotGapMaxMs).toBe(600);
        expect(main.snapshotGapsOver500).toBe(1);
        expect(main.snapshotGapMeanMs).toBe(round1((17 + 600 + 20) / 3));
    });

    it('counts heartbeat updates apart from frames, per visible second', () => {
        const window = new PerfWindow(0);
        const end = feed(window, 0, new Array(10).fill(100));
        for (let i = 0; i < 50; i++) {
            window.noteHeartbeat();
        }
        const frames = window.summarize(end, false).frames;
        expect(frames.count).toBe(10);
        expect(frames.rafPerSecond).toBe(10);
        expect(frames.heartbeatUpdates).toBe(50);
        expect(frames.heartbeatPerSecond).toBe(50);
    });

    it('reports steps per pump, the worker\'s own ms per step and drift', () => {
        const window = new PerfWindow(0);
        window.notePump(30, 6, 10, 24);
        window.notePump(10, 2, -2, 4);
        window.notePump(5, 1, undefined);
        const pump = window.summarize(1000, false).pump!;
        expect(pump.stepsPerPumpMean).toBe(3);
        expect(pump.stepsPerPumpMax).toBe(6);
        expect(pump.stepReturnMsPerStep).toBe(round1(28 / 8));
        expect(pump.stepReturnMaxMsPerStep).toBe(4);
        expect(pump.stepReturnMaxBatchMs).toBe(24);
        expect(pump.behindMeanTicks).toBe(4);
        expect(pump.behindMaxTicks).toBe(10);
    });

    it('leaves the worker\'s ms null when no step returned one', () => {
        const window = new PerfWindow(0);
        window.notePump(5, 2, 0);
        const pump = window.summarize(1000, false).pump!;
        expect(pump.stepReturnMsPerStep).toBeNull();
        expect(pump.stepReturnMaxBatchMs).toBeNull();
    });

    it('carries the missile count into a stall', () => {
        const window = new PerfWindow(0);
        window.noteCounts(counts({ missiles: 17 }));
        feed(window, 0, [16, 400]);
        expect(window.summarize(416, false).stalls[0].missiles).toBe(17);
    });
});
