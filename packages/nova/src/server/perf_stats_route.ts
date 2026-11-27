import express, { Express, NextFunction, Request, Response } from "express";
import { isLeft } from "fp-ts/lib/Either.js";
import * as fs from "fs/promises";
import * as path from "path";
import {
    PERF_STATS_MAX_BODY_BYTES, PERF_STATS_PATH, PerfSample, PerfSampleType,
} from "../common/perf_stats.js";

/**
 * ============================================================================
 * The server's end of the performance telemetry
 * ============================================================================
 *
 * `POST /perf_stats` takes one PerfSample (common/perf_stats.ts) as JSON,
 * validates it (bounded numbers, capped strings and arrays, unknown keys
 * stripped), rate-limits it, answers at once (204) and hands it to a sink:
 *
 * - FILE (a local server): one JSON line per sample appended to
 *   `packages/nova/perf_stats/<UTC date>.jsonl` (gitignored, like
 *   desyncs/), behind a serialized queue with byte caps.
 * - STDOUT (Cloud Run, whose filesystem is not kept): one structured JSON
 *   line per sample, which Cloud Logging stores as a jsonPayload
 *   (docs/perf_stats.md has the query).
 *
 * An HTTP route rather than a socket message: it needs no wire-schema
 * change (no protocol bump), it never touches the relay's message path,
 * and a beacon can deliver the last window as the page closes.
 *
 * Privacy: nothing about the request is stored — no address, no headers;
 * only the validated sample and the time it arrived.
 */

/** One stored record: a line in the .jsonl, or a Cloud Logging entry's
 * jsonPayload. */
export interface PerfStatsRecord {
    severity: 'INFO';
    message: 'novajs perf_stats';
    logType: typeof PERF_STATS_LOG_TYPE;
    receivedAt: string;
    sample: PerfSample;
}

/** Marks a record (the report and the log query filter on it). */
export const PERF_STATS_LOG_TYPE = 'novajs_perf_stats';

export function perfStatsRecord(sample: PerfSample,
    receivedAt: Date): PerfStatsRecord {
    return {
        severity: 'INFO',
        message: 'novajs perf_stats',
        logType: PERF_STATS_LOG_TYPE,
        receivedAt: receivedAt.toISOString(),
        sample,
    };
}

/** Where accepted samples go. `write` must not block the request. */
export interface PerfStatsSink {
    write(record: PerfStatsRecord): void;
}

/** Each record as one JSON line on stdout (Cloud Logging). */
export class StdoutPerfStatsSink implements PerfStatsSink {
    constructor(private readonly out: (line: string) => void =
        line => { process.stdout.write(line); }) { }

    write(record: PerfStatsRecord): void {
        this.out(JSON.stringify(record) + '\n');
    }
}

/** A day file's cap, and this process's lifetime cap. */
const DEFAULT_MAX_DAY_FILE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

/**
 * Appends each record as a line to `<dir>/<UTC YYYY-MM-DD>.jsonl`.
 * Writes are serialized (one append at a time, in arrival order) and
 * bounded: past a day file's cap, or the lifetime cap, records are
 * dropped with one warning.
 */
export class FilePerfStatsSink implements PerfStatsSink {
    private queue: Promise<void> = Promise.resolve();
    private madeDir = false;
    private written = 0;
    private readonly dayBytes = new Map<string, number>();
    private warnedFull = false;

    constructor(private readonly dir: string,
        private readonly maxDayFileBytes = DEFAULT_MAX_DAY_FILE_BYTES,
        private readonly maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
        private readonly warn: (m: string) => void = console.warn) { }

    write(record: PerfStatsRecord): void {
        const line = JSON.stringify(record) + '\n';
        const day = record.receivedAt.slice(0, 10);
        const bytes = Buffer.byteLength(line);
        const dayTotal = (this.dayBytes.get(day) ?? 0) + bytes;
        if (dayTotal > this.maxDayFileBytes
            || this.written + bytes > this.maxTotalBytes) {
            if (!this.warnedFull) {
                this.warnedFull = true;
                this.warn(`perf_stats: byte cap reached; dropping samples`);
            }
            return;
        }
        this.dayBytes.set(day, dayTotal);
        this.written += bytes;
        this.queue = this.queue.then(async () => {
            if (!this.madeDir) {
                await fs.mkdir(this.dir, { recursive: true });
                this.madeDir = true;
            }
            await fs.appendFile(path.join(this.dir, `${day}.jsonl`), line);
        }).catch(e => {
            this.warn(`perf_stats: failed to write a sample: ${String(e)}`);
        });
    }

    /** Resolves once every queued write has finished (specs). */
    flushed(): Promise<void> {
        return this.queue;
    }
}

/** Accepts nothing (NOVA_PERF_STATS=off). */
export class NullPerfStatsSink implements PerfStatsSink {
    write(): void { }
}

/** Several sinks at once (NOVA_PERF_STATS=both). */
export class TeePerfStatsSink implements PerfStatsSink {
    constructor(private readonly sinks: PerfStatsSink[]) { }
    write(record: PerfStatsRecord): void {
        for (const sink of this.sinks) {
            sink.write(record);
        }
    }
}

/**
 * The sink this process uses: NOVA_PERF_STATS = file | stdout | both |
 * off. Unset, it is `stdout` on Cloud Run (K_SERVICE is set there) and
 * `file` elsewhere; the file sink writes to NOVA_PERF_STATS_DIR, else
 * `defaultDir` (packages/nova/perf_stats).
 */
export function perfStatsSinkFromEnv(env: NodeJS.ProcessEnv,
    defaultDir: string): { sink: PerfStatsSink, description: string } {
    const mode = (env.NOVA_PERF_STATS
        ?? (env.K_SERVICE ? 'stdout' : 'file')).toLowerCase();
    const dir = env.NOVA_PERF_STATS_DIR || defaultDir;
    switch (mode) {
        case 'off':
            return { sink: new NullPerfStatsSink(), description: 'off' };
        case 'stdout':
            return { sink: new StdoutPerfStatsSink(), description: 'stdout' };
        case 'both':
            return {
                sink: new TeePerfStatsSink([new FilePerfStatsSink(dir),
                    new StdoutPerfStatsSink()]),
                description: `stdout and ${dir}`,
            };
        default:
            return { sink: new FilePerfStatsSink(dir), description: dir };
    }
}

// ── Rate limiting ─────────────────────────────────────────────────────

/** A token bucket: `capacity` sends at once, one more every `refillMs`. */
interface Bucket {
    tokens: number;
    updated: number;
}

export interface PerfStatsLimits {
    /** Per session: burst, and ms per further sample. A client sends one
     * every 12 s, plus one per system change. */
    sessionBurst: number;
    sessionRefillMs: number;
    /** Every session together. */
    globalBurst: number;
    globalRefillMs: number;
    /** Sessions tracked at once; idle ones are forgotten after
     * sessionIdleMs. */
    maxSessions: number;
    sessionIdleMs: number;
}

export const DEFAULT_PERF_STATS_LIMITS: PerfStatsLimits = {
    sessionBurst: 6,
    sessionRefillMs: 4_000,
    globalBurst: 100,
    globalRefillMs: 50,
    maxSessions: 10_000,
    sessionIdleMs: 10 * 60_000,
};

function take(bucket: Bucket, now: number, burst: number,
    refillMs: number): boolean {
    bucket.tokens = Math.min(burst,
        bucket.tokens + (now - bucket.updated) / refillMs);
    bucket.updated = now;
    if (bucket.tokens < 1) {
        return false;
    }
    bucket.tokens -= 1;
    return true;
}

/** The route's rate limiter: a bucket for everyone, and one per session
 * id (the client's random `sid`; nothing about the connection is kept). */
export class PerfStatsRateLimiter {
    private readonly global: Bucket;
    private readonly sessions = new Map<string, Bucket>();

    constructor(private readonly limits = DEFAULT_PERF_STATS_LIMITS,
        now = Date.now()) {
        this.global = { tokens: limits.globalBurst, updated: now };
    }

    /** Whether any sample may be taken now (before parsing one). */
    allowAny(now: number): boolean {
        const { globalBurst, globalRefillMs } = this.limits;
        return take(this.global, now, globalBurst, globalRefillMs);
    }

    /** Whether this session may send now. */
    allowSession(sid: string, now: number): boolean {
        const { sessionBurst, sessionRefillMs, maxSessions } = this.limits;
        let bucket = this.sessions.get(sid);
        if (!bucket) {
            if (this.sessions.size >= maxSessions) {
                this.prune(now);
                if (this.sessions.size >= maxSessions) {
                    return false;
                }
            }
            bucket = { tokens: sessionBurst, updated: now };
            this.sessions.set(sid, bucket);
        }
        return take(bucket, now, sessionBurst, sessionRefillMs);
    }

    /** Sessions tracked (specs). */
    get sessionCount(): number {
        return this.sessions.size;
    }

    private prune(now: number): void {
        for (const [sid, bucket] of this.sessions) {
            if (now - bucket.updated > this.limits.sessionIdleMs) {
                this.sessions.delete(sid);
            }
        }
    }
}

// ── The route ─────────────────────────────────────────────────────────

export interface PerfStatsRouteOptions {
    sink: PerfStatsSink;
    limiter?: PerfStatsRateLimiter;
    now?: () => Date;
}

/**
 * Registers `POST /perf_stats`. MUST be registered before setupRoutes'
 * catch-all, like the version route. Answers 204 (stored), 400 (not a
 * sample), 413 (too big), 429 (rate-limited); the client ignores all of
 * them.
 */
export function registerPerfStatsRoute(app: Express,
    options: PerfStatsRouteOptions): void {
    const limiter = options.limiter ?? new PerfStatsRateLimiter();
    const now = options.now ?? (() => new Date());
    app.post(PERF_STATS_PATH,
        (_req: Request, res: Response, next: NextFunction) => {
            // Refused before the body is even parsed when everyone
            // together is over the limit.
            if (!limiter.allowAny(now().getTime())) {
                res.status(429).end();
                return;
            }
            next();
        },
        // A beacon's Blob type is application/json; accept text/plain too
        // (a beacon of a bare string).
        express.json({
            limit: PERF_STATS_MAX_BODY_BYTES,
            type: ['application/json', 'text/plain'],
            strict: true,
        }),
        (req: Request, res: Response) => {
            const decoded = PerfSampleType.decode(req.body);
            if (isLeft(decoded)) {
                res.status(400).end();
                return;
            }
            const sample = decoded.right;
            const at = now();
            if (!limiter.allowSession(sample.sid, at.getTime())) {
                res.status(429).end();
                return;
            }
            res.status(204).end();
            try {
                options.sink.write(perfStatsRecord(sample, at));
            } catch {
                // A sink failure drops the sample, nothing more.
            }
        },
        // The body parser's own failures (too large, not JSON): a status,
        // never express's default error page and stack trace.
        (err: { status?: number, type?: string }, _req: Request,
            res: Response, _next: NextFunction) => {
            res.status(err?.type === 'entity.too.large' ? 413
                : (err?.status && err.status >= 400 && err.status < 500
                    ? err.status : 400)).end();
        });
}
