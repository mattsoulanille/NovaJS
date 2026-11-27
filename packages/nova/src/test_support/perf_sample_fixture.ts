import {
    ENTITY_COUNT_KEYS, EntityCounts, FRAME_HISTOGRAM_BUCKETS, PerfSample,
    PERF_STATS_VERSION, Stall,
} from '../common/perf_stats.js';

/** Entity counts with every key `value`, then `overrides`. */
export function makeEntityCounts(value = 0,
    overrides: Partial<EntityCounts> = {}): EntityCounts {
    const counts = {} as EntityCounts;
    for (const key of ENTITY_COUNT_KEYS) {
        counts[key] = value;
    }
    return { ...counts, ...overrides };
}

export function makeStall(overrides: Partial<Stall> = {}): Stall {
    return {
        ms: 150, atMs: 4000, tickerMs: 20, displayStepMs: 5, renderMs: 10,
        applyMs: 3, longTaskMs: 0, ships: 10, projectiles: 30, missiles: 4,
        beams: 2,
        entities: 80, onScreenEntities: 40, particles: 256,
        ...overrides,
    };
}

/** A valid in-space sample (PerfSampleType), with `overrides` on top. */
export function makePerfSample(overrides: Partial<PerfSample> = {}):
    PerfSample {
    const hist = new Array<number>(FRAME_HISTOGRAM_BUCKETS).fill(0);
    hist[2] = 700;
    return {
        v: PERF_STATS_VERSION,
        sid: 'abcdef01-2345-6789-abcd-ef0123456789',
        seq: 0,
        build: 'test-build',
        windowMs: 12000,
        spaceMs: 12000,
        landedMs: 0,
        transitMs: 0,
        hiddenMs: 0,
        system: 'nova:130',
        systemChanges: 0,
        speed: 1,
        playersInSpace: 1,
        frames: {
            count: 700, meanMs: 17.1, p50Ms: 16.7, p95Ms: 17.4, p99Ms: 18,
            worstMs: 30, over100: 0, over1000: 0, rafPerSecond: 58.3,
            heartbeatUpdates: 0, heartbeatPerSecond: 0, hist,
        },
        main: {
            tickerMeanMs: 6, tickerMaxMs: 12, displayStepMeanMs: 2,
            displayStepMaxMs: 4, renderMeanMs: 3, renderMaxMs: 7,
            otherMeanMs: 1, otherMaxMs: 2, applyCalls: 690,
            applyMeanMs: 1.2, applyMaxMs: 5, snapshotGapMeanMs: 17,
            snapshotGapMaxMs: 40, snapshotGapsOver500: 0,
        },
        longTasks: { count: 0, totalMs: 0, maxMs: 0 },
        heap: { usedMB: 120, minMB: 100, maxMB: 130, drops: 1 },
        sim: {
            pumps: 690, ticks: 720, tickRate: 60, roundTripMeanMs: 3,
            roundTripMaxMs: 9, stepsPerPumpMean: 1, stepsPerPumpMax: 2,
            stepReturnMsPerStep: 1.4, stepReturnMaxMsPerStep: 3,
            stepReturnMaxBatchMs: 5, behindMeanTicks: 0.4, behindMaxTicks: 1,
            worker: {
                stepCalls: 690, ticks: 720, tickMeanMs: 1.5,
                stepCallMaxMs: 6, snapshotCalls: 690, snapshotMeanMs: 0.8,
                snapshotMaxMs: 3,
            },
        },
        rollback: {
            rollbacks: 2, meanDepth: 3, maxDepth: 4,
            events: { rollback: 2, holdForRelay: 1 },
        },
        counts: {
            samples: 48,
            mean: makeEntityCounts(10, { entities: 80, onScreenEntities: 40 }),
            max: makeEntityCounts(12, { entities: 90, onScreenEntities: 45 }),
            particlesSpawned: 500,
        },
        stalls: [],
        env: {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 '
                + 'Safari/537.36',
            renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)',
            devicePixelRatio: 2,
            canvasWidth: 2048,
            canvasHeight: 1536,
            hardwareConcurrency: 8,
            deviceMemoryGB: 8,
        },
        ...overrides,
    };
}
