import 'jasmine';
import express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { PERF_STATS_PATH } from '../common/perf_stats.js';
import { makePerfSample } from '../test_support/perf_sample_fixture.js';
import {
    DEFAULT_PERF_STATS_LIMITS, FilePerfStatsSink, NullPerfStatsSink,
    PERF_STATS_LOG_TYPE, PerfStatsRateLimiter, PerfStatsRecord,
    perfStatsRecord, perfStatsSinkFromEnv, registerPerfStatsRoute,
    StdoutPerfStatsSink, TeePerfStatsSink,
} from './perf_stats_route.js';

describe('perf stats route', () => {
    let server: http.Server;
    let baseUrl: string;
    let records: PerfStatsRecord[];
    let clock: number;
    let limiter: PerfStatsRateLimiter;

    async function start(limits = DEFAULT_PERF_STATS_LIMITS) {
        records = [];
        clock = Date.parse('2026-11-27T12:00:00Z');
        limiter = new PerfStatsRateLimiter(limits, clock);
        const app = express();
        registerPerfStatsRoute(app, {
            sink: { write: record => { records.push(record); } },
            limiter,
            now: () => new Date(clock),
        });
        app.use('/', (_req, res) => { res.status(200).send('index'); });
        server = await new Promise<http.Server>(resolve => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    afterEach(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close(err => err ? reject(err) : resolve()));
    });

    function post(body: string, type = 'application/json') {
        return fetch(`${baseUrl}${PERF_STATS_PATH}`, {
            method: 'POST', body, headers: { 'content-type': type },
        });
    }

    it('stores a valid sample with the time it arrived, and answers 204',
        async () => {
            await start();
            const response = await post(JSON.stringify(makePerfSample()));
            expect(response.status).toBe(204);
            expect(records.length).toBe(1);
            expect(records[0].logType).toBe(PERF_STATS_LOG_TYPE);
            expect(records[0].receivedAt).toBe('2026-11-27T12:00:00.000Z');
            expect(records[0].sample.frames.count).toBe(700);
        });

    it('accepts a text/plain body (a beacon of a bare string)', async () => {
        await start();
        const response = await post(JSON.stringify(makePerfSample()),
            'text/plain;charset=UTF-8');
        expect(response.status).toBe(204);
        expect(records.length).toBe(1);
    });

    it('stores only the sample\'s own fields, never the request\'s', async () => {
        await start();
        const response = await post(JSON.stringify({
            ...makePerfSample(), pilotName: 'Captain Kirk', chat: 'hello',
        }));
        expect(response.status).toBe(204);
        const stored = JSON.stringify(records[0]);
        expect(stored).not.toContain('Captain');
        expect(stored).not.toContain('hello');
        expect(stored).not.toContain('127.0.0.1');
    });

    it('refuses what is not a sample with 400', async () => {
        await start();
        expect((await post(JSON.stringify({ hello: 'world' }))).status)
            .toBe(400);
        expect((await post('{not json')).status).toBe(400);
        expect((await post(JSON.stringify({
            ...makePerfSample(), windowMs: -1,
        }))).status).toBe(400);
        expect(records.length).toBe(0);
    });

    it('refuses a body over the size limit with 413', async () => {
        await start();
        const response = await post(JSON.stringify({
            ...makePerfSample(), padding: 'x'.repeat(20 * 1024),
        }));
        expect(response.status).toBe(413);
        expect(records.length).toBe(0);
    });

    it('wins over the catch-all for POST only', async () => {
        await start();
        const response = await fetch(`${baseUrl}${PERF_STATS_PATH}`);
        expect(await response.text()).toBe('index');
    });

    it('rate-limits each session, refilling over time', async () => {
        await start({ ...DEFAULT_PERF_STATS_LIMITS, sessionBurst: 2,
            sessionRefillMs: 4000 });
        const body = JSON.stringify(makePerfSample());
        expect((await post(body)).status).toBe(204);
        expect((await post(body)).status).toBe(204);
        expect((await post(body)).status).toBe(429);
        // Another session is not held back by this one.
        const other = JSON.stringify(makePerfSample({
            sid: 'ffffffff-2345-6789-abcd-ef0123456789',
        }));
        expect((await post(other)).status).toBe(204);
        clock += 4000;
        expect((await post(body)).status).toBe(204);
        expect(records.length).toBe(4);
    });

    it('rate-limits everyone together before parsing', async () => {
        await start({ ...DEFAULT_PERF_STATS_LIMITS, globalBurst: 1,
            globalRefillMs: 1000 });
        expect((await post(JSON.stringify(makePerfSample()))).status)
            .toBe(204);
        expect((await post('garbage that is never parsed')).status)
            .toBe(429);
    });
});

describe('PerfStatsRateLimiter', () => {
    it('forgets idle sessions when it is full, and refuses when it cannot',
        () => {
            const limits = {
                ...DEFAULT_PERF_STATS_LIMITS, maxSessions: 2,
                sessionIdleMs: 1000,
            };
            const limiter = new PerfStatsRateLimiter(limits, 0);
            expect(limiter.allowSession('a', 0)).toBeTrue();
            expect(limiter.allowSession('b', 0)).toBeTrue();
            expect(limiter.allowSession('c', 500)).toBeFalse();
            expect(limiter.allowSession('c', 2000)).toBeTrue();
            expect(limiter.sessionCount).toBe(1);
        });
});

describe('perf stats sinks', () => {
    const record = perfStatsRecord(makePerfSample(),
        new Date('2026-11-27T23:59:59Z'));

    it('writes one structured JSON line to stdout', () => {
        const lines: string[] = [];
        new StdoutPerfStatsSink(line => lines.push(line)).write(record);
        expect(lines.length).toBe(1);
        expect(lines[0].endsWith('\n')).toBeTrue();
        const parsed = JSON.parse(lines[0]);
        expect(parsed.severity).toBe('INFO');
        expect(parsed.logType).toBe(PERF_STATS_LOG_TYPE);
        expect(parsed.sample.sid).toBe(makePerfSample().sid);
    });

    it('appends JSON lines to a file per UTC day', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-stats-'));
        try {
            const sink = new FilePerfStatsSink(path.join(dir, 'perf_stats'));
            sink.write(record);
            sink.write(perfStatsRecord(makePerfSample({ seq: 1 }),
                new Date('2026-11-28T00:00:01Z')));
            sink.write(perfStatsRecord(makePerfSample({ seq: 2 }),
                new Date('2026-11-28T00:00:02Z')));
            await sink.flushed();
            const day1 = fs.readFileSync(
                path.join(dir, 'perf_stats', '2026-11-27.jsonl'), 'utf8');
            const day2 = fs.readFileSync(
                path.join(dir, 'perf_stats', '2026-11-28.jsonl'), 'utf8');
            expect(day1.trim().split('\n').length).toBe(1);
            expect(day2.trim().split('\n').map(l => JSON.parse(l).sample.seq))
                .toEqual([1, 2]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('drops past its byte cap, with one warning', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-stats-'));
        try {
            const warn = jasmine.createSpy('warn');
            const size = Buffer.byteLength(JSON.stringify(record) + '\n');
            const sink = new FilePerfStatsSink(dir, size * 2, 1e9, warn);
            for (let i = 0; i < 5; i++) {
                sink.write(record);
            }
            await sink.flushed();
            const lines = fs.readFileSync(path.join(dir, '2026-11-27.jsonl'),
                'utf8').trim().split('\n');
            expect(lines.length).toBe(2);
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('picks stdout on Cloud Run and the directory elsewhere', () => {
        expect(perfStatsSinkFromEnv({ K_SERVICE: 'nova' }, '/x').sink)
            .toBeInstanceOf(StdoutPerfStatsSink);
        const local = perfStatsSinkFromEnv({}, '/x/perf_stats');
        expect(local.sink).toBeInstanceOf(FilePerfStatsSink);
        expect(local.description).toBe('/x/perf_stats');
        expect(perfStatsSinkFromEnv({ NOVA_PERF_STATS_DIR: '/y' }, '/x')
            .description).toBe('/y');
        expect(perfStatsSinkFromEnv({ NOVA_PERF_STATS: 'off' }, '/x').sink)
            .toBeInstanceOf(NullPerfStatsSink);
        expect(perfStatsSinkFromEnv({ NOVA_PERF_STATS: 'both' }, '/x').sink)
            .toBeInstanceOf(TeePerfStatsSink);
        expect(perfStatsSinkFromEnv(
            { NOVA_PERF_STATS: 'file', K_SERVICE: 'nova' }, '/x').sink)
            .toBeInstanceOf(FilePerfStatsSink);
    });
});
