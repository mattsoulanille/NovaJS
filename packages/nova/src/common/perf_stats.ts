import * as t from 'io-ts';

/**
 * ============================================================================
 * Performance telemetry: the sample a client sends, and how it is checked
 * ============================================================================
 *
 * Every player's client (unless they switch "Send performance stats" off
 * in Preferences > Display) sends one compact summary of how the game ran
 * every ~12 s in space and every ~30 s landed: frame times, the main
 * thread's split, the simulation worker's step cost, what was in the
 * system and on screen, and the context to read it in (build, system, room
 * speed, browser, GPU). docs/perf_stats.md has the whole story.
 *
 * Shared by the client (client/perf_telemetry.ts, which builds samples)
 * and the server (server/perf_stats_route.ts, which decodes, bounds and
 * stores them), and by the report (server/perf_stats_report.ts). The
 * codec is the server's validation: every number bounded and finite,
 * every string and array length-capped, unknown keys stripped (exact
 * types), so what lands in a log line is exactly this shape and no
 * bigger.
 *
 * Privacy: no pilot name, no chat, no position, nothing from the save. The
 * only identity is `sid`, a random id the page makes once per load.
 */

/** Where samples are POSTed (server/perf_stats_route.ts). */
export const PERF_STATS_PATH = '/perf_stats';

/** The sample format; bumped on an incompatible change. */
export const PERF_STATS_VERSION = 1;

/** The largest body the route accepts. A full sample is ~2-3 KB. */
export const PERF_STATS_MAX_BODY_BYTES = 16 * 1024;

/**
 * Upper bounds (ms) of the frame-time histogram's buckets; one more
 * bucket past the last holds everything slower. Chosen around refresh
 * rates (120/90/60/40/30/20/10 Hz) and the stall sizes that matter:
 * 100 ms (a hitch), 250 ms, 1 s (the "a frame every few seconds" case).
 */
export const FRAME_HISTOGRAM_BOUNDS_MS =
    [8.5, 12, 17.5, 25, 34, 50, 100, 250, 1000] as const;
export const FRAME_HISTOGRAM_BUCKETS = FRAME_HISTOGRAM_BOUNDS_MS.length + 1;

/** Stalls (frames over STALL_MS) reported per sample, worst first. */
export const MAX_STALLS_PER_SAMPLE = 8;
/** A frame interval this long is a stall, reported with its context. */
export const STALL_MS = 100;

/** Rollback event names carried per sample, and their length. */
const MAX_EVENT_KINDS = 32;
const MAX_EVENT_NAME = 40;

// ── Bounded primitives ────────────────────────────────────────────────

/** A finite number in [min, max]. */
function bounded(name: string, min: number, max: number) {
    return new t.Type<number, number, unknown>(name,
        (u): u is number => typeof u === 'number' && Number.isFinite(u)
            && u >= min && u <= max,
        (u, c) => typeof u === 'number' && Number.isFinite(u)
            && u >= min && u <= max ? t.success(u) : t.failure(u, c),
        n => n);
}

/** A whole number in [0, max]. */
function count(max = 1e9) {
    return new t.Type<number, number, unknown>(`count<=${max}`,
        (u): u is number => Number.isInteger(u) && (u as number) >= 0
            && (u as number) <= max,
        (u, c) => Number.isInteger(u) && (u as number) >= 0
            && (u as number) <= max ? t.success(u as number) : t.failure(u, c),
        n => n);
}

/** Milliseconds: [0, 1 hour]. */
const Ms = bounded('ms', 0, 3_600_000);

/** A string of at most `max` characters (optionally matching `pattern`). */
function str(max: number, pattern?: RegExp) {
    return new t.Type<string, string, unknown>(`string<=${max}`,
        (u): u is string => typeof u === 'string' && u.length <= max
            && (!pattern || pattern.test(u)),
        (u, c) => typeof u === 'string' && u.length <= max
            && (!pattern || pattern.test(u)) ? t.success(u) : t.failure(u, c),
        s => s);
}

/** An array of at most `max` items. */
function arrayOf<C extends t.Mixed>(item: C, max: number, min = 0) {
    const array = t.array(item);
    return new t.Type<t.TypeOf<C>[], t.OutputOf<C>[], unknown>(
        `Array<=${max}`,
        (u): u is t.TypeOf<C>[] => array.is(u) && u.length <= max
            && u.length >= min,
        (u, c) => Array.isArray(u) && u.length <= max && u.length >= min
            ? array.validate(u, c) : t.failure(u, c),
        a => array.encode(a));
}

/** Event name -> count, at most MAX_EVENT_KINDS short names. */
const EventCounts = new t.Type<Record<string, number>,
    Record<string, number>, unknown>('EventCounts',
    (u): u is Record<string, number> => EventCounts.validate(u, [])
        ._tag === 'Right',
    (u, c) => {
        if (typeof u !== 'object' || u === null || Array.isArray(u)) {
            return t.failure(u, c);
        }
        const entries = Object.entries(u as Record<string, unknown>);
        if (entries.length > MAX_EVENT_KINDS) {
            return t.failure(u, c);
        }
        const out: Record<string, number> = Object.create(null);
        for (const [key, value] of entries) {
            if (key.length > MAX_EVENT_NAME || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)
                || !count().is(value)) {
                return t.failure(u, c);
            }
            out[key] = value;
        }
        return t.success({ ...out });
    },
    r => r);

function nullable<C extends t.Mixed>(codec: C) {
    return t.union([codec, t.null]);
}

// ── The sample ────────────────────────────────────────────────────────

/** What is in the display world, in total and on screen. Mean or max
 * over a window, so not necessarily whole. */
export const EntityCountsType = t.exact(t.type({
    ships: bounded('n', 0, 1e6),
    projectiles: bounded('n', 0, 1e6),
    /** Of the projectiles, the proximity-fused ones (ProxRadius > 0):
     * the simulation's ProjectileProximityFuseSystem is O(missiles x
     * collidables), its top hot spot in a big fight. */
    missiles: bounded('n', 0, 1e6),
    beams: bounded('n', 0, 1e6),
    explosions: bounded('n', 0, 1e6),
    asteroids: bounded('n', 0, 1e6),
    planets: bounded('n', 0, 1e6),
    /** Every display-world entity. */
    entities: bounded('n', 0, 1e6),
    /** GPU particles alive (upper bound: live blocks x block size). */
    particles: bounded('n', 0, 1e6),
    onScreenShips: bounded('n', 0, 1e6),
    onScreenProjectiles: bounded('n', 0, 1e6),
    onScreenBeams: bounded('n', 0, 1e6),
    onScreenExplosions: bounded('n', 0, 1e6),
    onScreenAsteroids: bounded('n', 0, 1e6),
    onScreenEntities: bounded('n', 0, 1e6),
}));
export type EntityCounts = t.TypeOf<typeof EntityCountsType>;

/** The keys of EntityCounts, in a fixed order (the sampler's arrays). */
export const ENTITY_COUNT_KEYS = Object.keys(
    EntityCountsType.type.props) as (keyof EntityCounts)[];

/** One long frame, with what the main thread and the world looked like. */
export const StallType = t.exact(t.type({
    /** The frame interval. */
    ms: Ms,
    /** When it ended, ms into the window. */
    atMs: Ms,
    /** The ticker work of the frame before the gap, split up. */
    tickerMs: Ms,
    displayStepMs: Ms,
    renderMs: Ms,
    /** Simulation frames applied to the display world in the gap. */
    applyMs: Ms,
    /** Long tasks (PerformanceObserver) that overlapped the gap. */
    longTaskMs: Ms,
    /** The last entity count before it (counted 4x a second). */
    ships: bounded('n', 0, 1e6),
    projectiles: bounded('n', 0, 1e6),
    missiles: bounded('n', 0, 1e6),
    beams: bounded('n', 0, 1e6),
    entities: bounded('n', 0, 1e6),
    onScreenEntities: bounded('n', 0, 1e6),
    particles: bounded('n', 0, 1e6),
}));
export type Stall = t.TypeOf<typeof StallType>;

export const FrameStatsType = t.exact(t.type({
    /** Frames that ended in the window (hidden-tab frames excluded). */
    count: count(),
    meanMs: Ms,
    p50Ms: Ms,
    p95Ms: Ms,
    p99Ms: Ms,
    worstMs: Ms,
    over100: count(),
    over1000: count(),
    /** Animation frames per second of visible time (the frames above). */
    rafPerSecond: bounded('rate', 0, 10_000),
    /** Ticker updates the frame pump's background heartbeat drove
     * because rAF was over 100 ms stale (they never draw), in all and
     * per second of visible time. Not counted as frames. */
    heartbeatUpdates: count(),
    heartbeatPerSecond: bounded('rate', 0, 10_000),
    /** Frame counts per FRAME_HISTOGRAM_BOUNDS_MS bucket. */
    hist: arrayOf(count(), FRAME_HISTOGRAM_BUCKETS, FRAME_HISTOGRAM_BUCKETS),
}));
export type FrameStats = t.TypeOf<typeof FrameStatsType>;

/** The main thread's time per frame, split as far as it cheaply goes. */
export const MainThreadStatsType = t.exact(t.type({
    /** All ticker work: display step, the pump's synchronous part, other
     * listeners, and the render. */
    tickerMeanMs: Ms,
    tickerMaxMs: Ms,
    /** The display world's step (FramePump.tick). */
    displayStepMeanMs: Ms,
    displayStepMaxMs: Ms,
    /** PIXI's render. */
    renderMeanMs: Ms,
    renderMaxMs: Ms,
    /** Ticker work that is neither (the pump, the arrival check, ...). */
    otherMeanMs: Ms,
    otherMaxMs: Ms,
    /** Simulation frames applied to the display world (state apply),
     * off the ticker: count, mean per call, max. */
    applyCalls: count(),
    applyMeanMs: Ms,
    applyMaxMs: Ms,
    /** The time between consecutive landed snapshots (applies) in one
     * system, visible tab only: mean, max, and how many gaps passed
     * 500 ms (STALE_SNAPSHOT_MS: past it, ships stop extrapolating and
     * freeze until the next snapshot). */
    snapshotGapMeanMs: Ms,
    snapshotGapMaxMs: Ms,
    snapshotGapsOver500: count(),
}));

export const SimStatsType = t.exact(t.type({
    /** Pump round trips (step + snapshot) completed, and ticks asked. */
    pumps: count(),
    ticks: count(),
    /** Ticks per second of window. */
    tickRate: bounded('rate', 0, 10_000),
    roundTripMeanMs: Ms,
    roundTripMaxMs: Ms,
    /** Steps asked per pump (the batch the pump hands the worker). */
    stepsPerPumpMean: bounded('steps', 0, 1e6),
    stepsPerPumpMax: count(),
    /** The worker's own ms for each batch, as bridge.step returns it
     * (the pump's batch cap reads the same figure): per step, mean and
     * worst batch's, and the largest batch. Null when no step returned
     * a figure. */
    stepReturnMsPerStep: nullable(Ms),
    stepReturnMaxMsPerStep: nullable(Ms),
    stepReturnMaxBatchMs: nullable(Ms),
    /** pacing.behindTicks, how far the sim trails the room's clock
     * (negative when ahead): mean and largest over the pumps. */
    behindMeanTicks: bounded('ticks', -1e6, 1e6),
    behindMaxTicks: bounded('ticks', -1e6, 1e6),
    /** The worker's own measure (SimulationPerfCounters), null when the
     * bridge could not be asked (a transition took it). */
    worker: nullable(t.exact(t.type({
        stepCalls: count(),
        ticks: count(),
        /** Mean wall ms per simulated tick. */
        tickMeanMs: Ms,
        stepCallMaxMs: Ms,
        snapshotCalls: count(),
        snapshotMeanMs: Ms,
        snapshotMaxMs: Ms,
    }))),
}));

export const RollbackStatsType = t.exact(t.type({
    rollbacks: count(),
    meanDepth: bounded('ticks', 0, 1e6),
    maxDepth: count(),
    /** status().rollbackEvents over the window: holdForRelay, resync,
     * lateRecord, retimed, ... */
    events: EventCounts,
}));

export const EnvType = t.exact(t.type({
    userAgent: str(400),
    /** The WebGL renderer string (unmasked where the browser allows). */
    renderer: nullable(str(200)),
    devicePixelRatio: bounded('dpr', 0, 16),
    /** The canvas's backing size, device pixels. */
    canvasWidth: count(32768),
    canvasHeight: count(32768),
    hardwareConcurrency: nullable(count(4096)),
    /** navigator.deviceMemory (GB, Chrome only, coarse). */
    deviceMemoryGB: nullable(bounded('GB', 0, 1e4)),
}));

export const PerfSampleType = t.exact(t.type({
    v: t.literal(PERF_STATS_VERSION),
    /** A random id made once per page load: the only identity. */
    sid: str(64, /^[A-Za-z0-9-]{8,64}$/),
    /** This sample's number in the session (0, 1, ...). */
    seq: count(1e6),
    build: str(120),
    /** Wall ms the window covers, and where it was spent. */
    windowMs: Ms,
    spaceMs: Ms,
    landedMs: Ms,
    transitMs: Ms,
    /** Spent with the tab hidden: those frames are not counted. */
    hiddenMs: Ms,
    /** The system at the end of the window (a game-data id, e.g.
     * nova:130), and how many times it changed during it. */
    system: nullable(str(40)),
    systemChanges: count(1000),
    /** Room speed (1x / 2x) at the end of the window. */
    speed: nullable(bounded('speed', 0, 16)),
    /** In-space players in the room (the speed vote's voter count). */
    playersInSpace: nullable(count(10_000)),
    frames: FrameStatsType,
    main: MainThreadStatsType,
    longTasks: nullable(t.exact(t.type({
        count: count(), totalMs: Ms, maxMs: Ms,
    }))),
    /** performance.memory (Chrome): JS heap in MB, and how often it
     * dropped by more than HEAP_DROP_MB between readings (a GC hint). */
    heap: nullable(t.exact(t.type({
        usedMB: bounded('MB', 0, 1e6),
        minMB: bounded('MB', 0, 1e6),
        maxMB: bounded('MB', 0, 1e6),
        drops: count(),
    }))),
    /** In space only; null in a landed-only window. */
    sim: nullable(SimStatsType),
    rollback: nullable(RollbackStatsType),
    /** Entity counts over the window (sampled 4x a second); null when
     * nothing was counted (landed). */
    counts: nullable(t.exact(t.type({
        samples: count(),
        mean: EntityCountsType,
        max: EntityCountsType,
        /** GPU particles spawned in the window. */
        particlesSpawned: count(),
    }))),
    stalls: arrayOf(StallType, MAX_STALLS_PER_SAMPLE),
    env: EnvType,
}));
export type PerfSample = t.TypeOf<typeof PerfSampleType>;
