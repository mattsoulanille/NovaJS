import 'jasmine';
import { FRAME_HISTOGRAM_BUCKETS, PerfSample } from '../common/perf_stats.js';
import {
    makeEntityCounts, makePerfSample, makeStall,
} from '../test_support/perf_sample_fixture.js';
import { histogramBucket } from '../client/perf_sampler.js';
import { perfStatsRecord } from './perf_stats_route.js';
import {
    buildPerfReport, formatPerfReport, linearFit, parsePerfStats,
    scalingTable, shortUserAgent, summarizeFrames, unaccountedMs,
} from './perf_stats_report.js';

function line(sample: PerfSample, at: string): string {
    return JSON.stringify(perfStatsRecord(sample, new Date(at)));
}

/** A sample whose frames are all `ms` long, `count` of them. */
function steady(ms: number, count: number,
    overrides: Partial<PerfSample> = {}): PerfSample {
    const hist = new Array<number>(FRAME_HISTOGRAM_BUCKETS).fill(0);
    const base = makePerfSample(overrides);
    hist[histogramBucket(ms)] = count;
    return {
        ...base,
        frames: {
            count, meanMs: ms, p50Ms: ms, p95Ms: ms, p99Ms: ms, worstMs: ms,
            over100: ms > 100 ? count : 0, over1000: ms > 1000 ? count : 0,
            rafPerSecond: 1000 / ms, heartbeatUpdates: 0,
            heartbeatPerSecond: 0, hist,
        },
        ...overrides,
    };
}

describe('perf stats report', () => {
    it('parses the server\'s JSON lines, skipping what is not a sample', () => {
        const text = [
            line(makePerfSample(), '2026-11-27T12:00:00Z'),
            '',
            'not json',
            JSON.stringify({ something: 'else' }),
            line(makePerfSample({ seq: 1 }), '2026-11-27T12:00:12Z'),
        ].join('\n');
        const { samples, skipped } = parsePerfStats(text);
        expect(samples.length).toBe(2);
        expect(skipped).toBe(2);
        expect(samples[1].receivedAt).toBe('2026-11-27T12:00:12.000Z');
    });

    it('parses a Cloud Logging export (gcloud --format=json)', () => {
        const record = perfStatsRecord(makePerfSample(),
            new Date('2026-11-27T12:00:00Z'));
        const entries = [
            { jsonPayload: record, timestamp: '2026-11-27T12:00:00.1Z' },
            { textPayload: 'GCSFuse noise' },
            // A bare sample in a payload takes the entry's timestamp.
            {
                jsonPayload: makePerfSample({ seq: 1 }),
                timestamp: '2026-11-27T12:00:13Z',
            },
        ];
        const { samples, skipped } = parsePerfStats(
            JSON.stringify(entries, null, 2));
        expect(samples.length).toBe(2);
        expect(skipped).toBe(1);
        expect(samples[0].receivedAt).toBe('2026-11-27T12:00:00.000Z');
        expect(samples[1].receivedAt).toBe('2026-11-27T12:00:13Z');
    });

    it('drops samples that fail validation', () => {
        const bad = { ...makePerfSample(), windowMs: -5 };
        expect(parsePerfStats(JSON.stringify(bad)).samples.length).toBe(0);
    });

    it('merges frame statistics weighting by frames', () => {
        const summary = summarizeFrames([
            steady(16, 600), steady(50, 200),
        ]);
        expect(summary.frames).toBe(800);
        expect(summary.seconds).toBeCloseTo((600 * 16 + 200 * 50) / 1000);
        expect(summary.meanFps).toBeCloseTo(800 / summary.seconds);
        expect(summary.p50BucketMs).toBe(17.5);
        expect(summary.p95BucketMs).toBe(50);
        expect(summary.histogram[2]).toBeCloseTo(0.75);
    });

    it('counts stalls per minute and the worst', () => {
        const summary = summarizeFrames([
            steady(16, 3750), steady(2000, 1),
        ]);
        expect(summary.over100).toBe(1);
        expect(summary.over1000).toBe(1);
        expect(summary.worstMs).toBe(2000);
        expect(summary.stallsPerMinute).toBeCloseTo(1 / (62 / 60), 1);
    });

    it('lists the worst stalls across sessions, worst first', () => {
        const report = buildPerfReport([
            {
                receivedAt: 'a', sample: makePerfSample({
                    stalls: [makeStall({ ms: 300 }), makeStall({ ms: 3100 })],
                }),
            },
            {
                receivedAt: 'b', sample: makePerfSample({
                    sid: 'ffffffff-2345-6789-abcd-ef0123456789',
                    stalls: [makeStall({ ms: 900 })],
                }),
            },
        ], 0, 2);
        expect(report.stalls.map(s => s.ms)).toEqual([3100, 900]);
        expect(report.sessions).toBe(2);
    });

    it('explains a stall by the larger of its ticker work and long tasks',
        () => {
            expect(unaccountedMs(makeStall({
                ms: 1000, tickerMs: 100, applyMs: 50, longTaskMs: 0,
            }))).toBe(850);
            expect(unaccountedMs(makeStall({
                ms: 1000, tickerMs: 100, applyMs: 50, longTaskMs: 900,
            }))).toBe(100);
        });

    it('bins frame time by entities on screen', () => {
        const at = (onScreen: number, ms: number) => steady(ms, 600, {
            counts: {
                samples: 48,
                mean: makeEntityCounts(0, { onScreenEntities: onScreen,
                    entities: onScreen * 2 }),
                max: makeEntityCounts(0),
                particlesSpawned: 0,
            },
        });
        const rows = scalingTable([at(10, 16), at(20, 18), at(150, 40),
            at(1000, 200)], 'onScreenEntities');
        expect(rows.map(r => [r.from, r.samples, r.meanFrameMs])).toEqual([
            [0, 2, 17], [100, 1, 40], [800, 1, 200],
        ]);
        expect(rows[2].stallsPer1000Frames).toBe(1000);
    });

    it('fits a line through the samples', () => {
        const fit = linearFit([0, 100, 200], [16, 26, 36]);
        expect(fit.slope).toBeCloseTo(0.1);
        expect(fit.intercept).toBeCloseTo(16);
        expect(fit.r).toBeCloseTo(1);
        expect(linearFit([5], [3]).n).toBe(1);
    });

    it('names browsers and systems briefly', () => {
        expect(shortUserAgent(makePerfSample().env.userAgent))
            .toBe('Chrome 131 / macOS');
        expect(shortUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) '
            + 'Gecko/20100101 Firefox/133.0')).toBe('Firefox 133 / Linux');
        expect(shortUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like '
            + 'Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
            + 'Version/18.1 Mobile/15E148 Safari/604.1')).toBe('Safari 18 / iOS');
    });

    it('formats every section', () => {
        const report = buildPerfReport([
            { receivedAt: '2026-11-27T12:00:00Z', sample: makePerfSample({
                stalls: [makeStall({ ms: 2400 })],
            }) },
            { receivedAt: '2026-11-27T12:00:12Z', sample: makePerfSample({
                seq: 1, build: 'other-build',
            }) },
        ]);
        const text = formatPerfReport(report);
        for (const heading of ['== Per build', '== Per session',
            '== Worst stalls', '== Frame time by entities ON SCREEN',
            '== Frame time by entities IN THE SYSTEM', '== Linear fits']) {
            expect(text).toContain(heading);
        }
        expect(text).toContain('test-build');
        expect(text).toContain('other-build');
        expect(text).toContain('2400');
        expect(text).toContain('Chrome 131 / macOS');
    });

    it('prints no fit from too few samples', () => {
        const text = formatPerfReport(buildPerfReport([
            { receivedAt: 'a', sample: makePerfSample() },
        ]));
        expect(text).toContain('too few samples: 1');
    });

    it('says so when there is nothing to report', () => {
        expect(formatPerfReport(buildPerfReport([])))
            .toContain('0 samples');
    });
});
