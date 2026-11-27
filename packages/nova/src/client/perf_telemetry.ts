/**
 * ============================================================================
 * Performance telemetry: every player's client, as they play
 * ============================================================================
 *
 * Samples how the game runs while a session is open and sends a compact
 * summary (common/perf_stats.ts PerfSample) to the server every ~12 s in
 * space and every ~30 s landed, unless the player switched "Send
 * performance stats" off (Preferences > Display). docs/perf_stats.md has
 * the whole story, the server side and the report.
 *
 * What it measures, and where:
 * - Frame times: the interval between ticker frames, taken by a listener
 *   that runs FIRST in each ticker frame (priority FRAME_START_PRIORITY).
 * - The main thread's split per frame: all ticker work (first listener to
 *   last), the render (a listener just before PIXI's render to one just
 *   after it), and the display world's step (FramePump.tick reports it).
 *   The state apply (FramePump.applyFrame) runs off the ticker, when a
 *   simulation round trip lands; the pump reports it too.
 * - The simulation: the pump's step + snapshot round trips (main thread)
 *   and the worker's own step / snapshot cost and rollback activity
 *   (bridge.perfCounters(), asked once per sample).
 * - Long tasks (PerformanceObserver 'longtask', Chromium), the JS heap
 *   (performance.memory, Chromium), and the display world's entity counts
 *   (perf_entity_counts.ts), 4x a second off the ticker.
 *
 * Display-side only: nothing here is synced, nothing reaches the
 * simulation's state, and a send that fails is dropped. The per-frame
 * hooks allocate nothing (perf_sampler.ts).
 */
import type * as PIXI from 'pixi.js';
import { v4 } from 'uuid';
import {
    ENTITY_COUNT_KEYS, PERF_STATS_PATH, PERF_STATS_VERSION, PerfSample,
} from '../common/perf_stats.js';
import type { SimulationPerfCounters } from '../communication/simulation_bridge_api.js';
import { RoomSpeedResource } from '../display/speed_indicator_plugin.js';
import { loadPerfStatsEnabled } from '../title/client_prefs.js';
import { ClientState, liveSystem } from './client_state.js';
import {
    countDisplayEntities, particlesSpawnedTotal, ViewBox,
} from './perf_entity_counts.js';
import { MeasuredSample, PerfPhase, PerfWindow, round1 } from './perf_sampler.js';

/** A summary this often while any of the window was in space... */
export const SPACE_SAMPLE_MS = 12_000;
/** ...and this often when it was all landed or in transit. */
export const LANDED_SAMPLE_MS = 30_000;
/** A system change closes a window at least this long, so a sample
 * describes one system; a shorter one runs on into the next system. */
export const MIN_SYSTEM_WINDOW_MS = 3_000;
/** How often entity counts and the heap are read. */
export const COUNT_INTERVAL_MS = 250;
/** How long a sample waits for the worker's counters before going
 * without them. */
const WORKER_COUNTERS_TIMEOUT_MS = 2_000;

/** Ticker priorities (PIXI.UPDATE_PRIORITY: INTERACTION 50, HIGH 25,
 * NORMAL 0, LOW -25 = the render, UTILITY -50). */
const FRAME_START_PRIORITY = 1000 as PIXI.UPDATE_PRIORITY;
const PRE_RENDER_PRIORITY = -24 as PIXI.UPDATE_PRIORITY;
const FRAME_END_PRIORITY = -1000 as PIXI.UPDATE_PRIORITY;

/** What the frame pump reports (client/frame_pump.ts). */
export interface PerfProbe {
    /** The display world's step, this ticker frame. */
    noteDisplayStep(ms: number): void;
    /** One simulation frame applied to the display world, from the
     * live system `source` (gaps are measured within one system). */
    noteApply(ms: number, source?: unknown): void;
    /** One step + snapshot round trip that stepped `ticks`; the worker's
     * own ms for the batch when bridge.step returned it. */
    notePump(roundTripMs: number, ticks: number,
        behindTicks: number | undefined, workerBatchMs?: number): void;
    /** The heartbeat is about to drive (and has driven) a drawless
     * ticker update: the hooks count it, not as a frame. */
    beginHeartbeat(): void;
    endHeartbeat(): void;
}

/** What the telemetry reads from the page (browser.ts / game_session.ts
 * supply the real ones; the specs, fakes). */
export interface PerfTelemetryHost {
    app: Pick<PIXI.Application, 'ticker' | 'renderer' | 'view'>;
    /** The client's state, read live. */
    state(): ClientState;
    buildVersion: string;
    /** Whether the player lets the stats go (Preferences > Display). */
    enabled?(): boolean;
    /** Sends one sample; `final` when the page may be going away. */
    send?(body: string, final: boolean): void;
    now?(): number;
}

/** Which telemetry phase a client state is. */
export function perfPhase(state: ClientState): PerfPhase {
    switch (state.kind) {
        case 'inSpace':
            return 'space';
        case 'landing':
        case 'landed':
        case 'gateLanding':
        case 'gateMap':
            return 'landed';
        default:
            return 'transit';
    }
}

/** The default send: a keepalive POST, or a beacon when the page is
 * going away. Failure of either is silently a dropped sample. */
export function sendPerfSample(body: string, final: boolean): void {
    try {
        if (final && typeof navigator !== 'undefined'
            && typeof navigator.sendBeacon === 'function') {
            navigator.sendBeacon(PERF_STATS_PATH,
                new Blob([body], { type: 'application/json' }));
            return;
        }
        void fetch(PERF_STATS_PATH, {
            method: 'POST', body, keepalive: true,
            headers: { 'content-type': 'application/json' },
        }).catch(() => undefined);
    } catch {
        // Dropped.
    }
}

/** The WebGL renderer string, unmasked where the browser allows it. */
export function webglRendererString(renderer: unknown): string | null {
    try {
        const gl = (renderer as { gl?: WebGLRenderingContext }).gl;
        if (!gl) {
            return null;
        }
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const value = info
            ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER);
        return typeof value === 'string' ? value.slice(0, 200) : null;
    } catch {
        return null;
    }
}

/** A random id for this page load: the samples' only identity. */
export function makeSessionId(): string {
    try {
        return globalThis.crypto?.randomUUID?.() ?? v4();
    } catch {
        return v4();
    }
}

/** The session id for this page load (one across Enter Ship / exit
 * cycles, so a report can follow a whole visit). */
const PAGE_SESSION_ID = makeSessionId();

export class PerfTelemetry implements PerfProbe {
    readonly sessionId = PAGE_SESSION_ID;
    /** The last sample built (sent or not), for the console and specs. */
    lastSample: PerfSample | undefined;
    /** Samples built so far. */
    private seq = 0;
    private readonly window: PerfWindow;
    private readonly now: () => number;
    // The frame in progress.
    private lastFrameStart: number | undefined;
    private frameStart = 0;
    private preRenderAt = 0;
    private displayStepMs = 0;
    private frameOpen = false;
    private heartbeating = false;
    // Counting.
    private readonly countBuffer = new Float64Array(ENTITY_COUNT_KEYS.length);
    private readonly box: ViewBox = { left: 0, right: 0, top: 0, bottom: 0 };
    private lastParticlesSpawned: number | undefined;
    private particleWorld: unknown;
    // Windows and systems.
    private windowSystem: string | null = null;
    private systemChanges = 0;
    private longTasksSupported = false;
    private renderer: string | null = null;
    private disposers: Array<() => void> = [];

    constructor(private readonly host: PerfTelemetryHost) {
        this.now = host.now ?? (() => performance.now());
        this.window = new PerfWindow(this.now());
    }

    // ── The per-frame hooks (allocation-free) ─────────────────────────

    /** First listener of a ticker frame: closes the previous interval. */
    readonly frameStartHook = () => {
        if (this.heartbeating) {
            this.window.noteHeartbeat();
            return;
        }
        const now = this.now();
        if (this.lastFrameStart !== undefined) {
            this.window.addFrame(now - this.lastFrameStart, now,
                perfPhase(this.host.state()), isHidden());
        }
        this.lastFrameStart = now;
        this.frameStart = now;
        this.preRenderAt = now;
        this.displayStepMs = 0;
        this.frameOpen = true;
    };

    /** Just before PIXI's render. */
    readonly preRenderHook = () => {
        if (this.heartbeating) {
            return;
        }
        this.preRenderAt = this.now();
    };

    /** Last listener of a ticker frame. */
    readonly frameEndHook = () => {
        if (this.heartbeating || !this.frameOpen) {
            return;
        }
        this.frameOpen = false;
        const now = this.now();
        this.window.noteTicker(now - this.frameStart, this.displayStepMs,
            now - this.preRenderAt);
    };

    noteDisplayStep(ms: number): void {
        if (!this.heartbeating) {
            this.displayStepMs += ms;
        }
    }

    noteApply(ms: number, source?: unknown): void {
        this.window.noteApply(ms, this.now(), source, isHidden());
    }

    notePump(roundTripMs: number, ticks: number,
        behindTicks: number | undefined, workerBatchMs?: number): void {
        this.window.notePump(roundTripMs, ticks, behindTicks, workerBatchMs);
    }

    beginHeartbeat(): void {
        this.heartbeating = true;
    }

    endHeartbeat(): void {
        this.heartbeating = false;
    }

    // ── Installation ──────────────────────────────────────────────────

    /**
     * Hooks the ticker, the long-task observer, the count timer and the
     * page-hide flush. Returns the disposer (which sends what the window
     * holds, as the session ends).
     */
    install(): () => void {
        const { ticker } = this.host.app;
        ticker.add(this.frameStartHook, undefined, FRAME_START_PRIORITY);
        ticker.add(this.preRenderHook, undefined, PRE_RENDER_PRIORITY);
        ticker.add(this.frameEndHook, undefined, FRAME_END_PRIORITY);
        this.disposers.push(() => {
            ticker.remove(this.frameStartHook);
            ticker.remove(this.preRenderHook);
            ticker.remove(this.frameEndHook);
        });
        this.renderer = webglRendererString(this.host.app.renderer);
        this.installLongTaskObserver();
        const timer = setInterval(() => this.tick(), COUNT_INTERVAL_MS);
        this.disposers.push(() => clearInterval(timer));
        if (typeof window !== 'undefined') {
            const onHide = () => this.flushFinal();
            window.addEventListener('pagehide', onHide);
            this.disposers.push(
                () => window.removeEventListener('pagehide', onHide));
        }
        return () => {
            for (const dispose of this.disposers) {
                dispose();
            }
            this.disposers = [];
            this.flushFinal();
        };
    }

    private installLongTaskObserver(): void {
        if (typeof PerformanceObserver === 'undefined'
            || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
            return;
        }
        try {
            const observer = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    this.window.noteLongTask(entry.startTime, entry.duration);
                }
            });
            observer.observe({ type: 'longtask', buffered: false });
            this.longTasksSupported = true;
            this.disposers.push(() => observer.disconnect());
        } catch {
            // No long tasks on this browser.
        }
    }

    // ── The 4 Hz timer: counts, heap, and when to send ───────────────

    /** Runs every COUNT_INTERVAL_MS (exposed for the specs). */
    tick(): void {
        const now = this.now();
        const state = this.host.state();
        const live = liveSystem(state);
        const system = live?.systemId ?? null;
        if (system !== null && system !== this.windowSystem) {
            if (this.windowSystem !== null
                && now - this.window.start >= MIN_SYSTEM_WINDOW_MS) {
                // The window so far belongs to the system being left.
                // (Without the worker's counters: the bridge now live is
                // the new system's, and its counters belong to the next
                // window.)
                void this.flush(now, 'systemChange');
            } else if (this.windowSystem !== null) {
                this.systemChanges++;
            }
            this.windowSystem = system;
        }
        if (!this.enabled()) {
            return;
        }
        if (live && state.kind === 'inSpace') {
            countDisplayEntities(live.world, this.countBuffer, this.box);
            this.window.noteCounts(this.countBuffer);
            const spawned = particlesSpawnedTotal(live.world);
            if (spawned !== undefined) {
                if (this.particleWorld === live.world
                    && this.lastParticlesSpawned !== undefined) {
                    this.window.noteParticlesSpawned(
                        spawned - this.lastParticlesSpawned);
                }
                this.particleWorld = live.world;
                this.lastParticlesSpawned = spawned;
            }
        }
        const heap = (performance as unknown as {
            memory?: { usedJSHeapSize?: number },
        }).memory?.usedJSHeapSize;
        if (typeof heap === 'number') {
            this.window.noteHeap(heap / (1024 * 1024));
        }
        const period = this.window.phaseTime('space') > 0
            ? SPACE_SAMPLE_MS : LANDED_SAMPLE_MS;
        if (now - this.window.start >= period) {
            void this.flush(now, 'periodic');
        }
    }

    private enabled(): boolean {
        return this.host.enabled ? this.host.enabled() : loadPerfStatsEnabled();
    }

    // ── Building and sending ─────────────────────────────────────────

    /**
     * Closes the window at `now` and sends it. A 'periodic' sample asks
     * the live bridge for the worker's counters first; a 'systemChange'
     * one does not (that bridge is the next system's), and a 'final' one
     * cannot (the page may be going away: it leaves synchronously, as a
     * beacon). Resolves to the sample once sent, or undefined when it was
     * dropped (switched off, or no frames).
     */
    flush(now = this.now(), mode: 'periodic' | 'systemChange' | 'final'
        = 'periodic'): Promise<PerfSample | undefined> {
        const final = mode === 'final';
        const measured = this.window.summarize(now, this.longTasksSupported);
        const system = this.windowSystem;
        const systemChanges = this.systemChanges;
        this.window.reset(now);
        this.systemChanges = 0;
        if (!this.enabled() || measured.frames.count === 0) {
            return Promise.resolve(undefined);
        }
        const state = this.host.state();
        const live = liveSystem(state);
        const context = this.context(state, system, systemChanges);
        if (mode !== 'periodic' || !live || !measured.pump) {
            return Promise.resolve(this.send(measured, context, null, final));
        }
        const bridge = live.bridge;
        return withTimeout(bridge.perfCounters(), WORKER_COUNTERS_TIMEOUT_MS)
            .catch(() => null)
            .then(counters => this.send(measured, context, counters, false));
    }

    /** Sends the window as the page goes away (or the session ends). */
    flushFinal(): void {
        void this.flush(this.now(), 'final');
    }

    private context(state: ClientState, system: string | null,
        systemChanges: number) {
        const live = liveSystem(state);
        const speed = live?.world.resources.get(RoomSpeedResource)?.status;
        return {
            system: (system ?? live?.systemId ?? null)?.slice(0, 40) ?? null,
            systemChanges,
            speed: speed?.speed ?? null,
            playersInSpace: speed?.totalVoters ?? null,
        };
    }

    private send(measured: MeasuredSample,
        context: ReturnType<PerfTelemetry['context']>,
        counters: SimulationPerfCounters | null,
        final: boolean): PerfSample {
        const { pump, ...rest } = measured;
        const sample: PerfSample = {
            v: PERF_STATS_VERSION,
            sid: this.sessionId,
            seq: this.seq++,
            build: this.host.buildVersion.slice(0, 120),
            ...rest,
            ...context,
            sim: pump ? {
                ...pump,
                worker: counters ? {
                    stepCalls: counters.stepCalls,
                    ticks: counters.ticks,
                    tickMeanMs: round1(counters.ticks > 0
                        ? counters.stepMs / counters.ticks : 0),
                    stepCallMaxMs: round1(counters.stepCallMaxMs),
                    snapshotCalls: counters.snapshotCalls,
                    snapshotMeanMs: round1(counters.snapshotCalls > 0
                        ? counters.snapshotMs / counters.snapshotCalls : 0),
                    snapshotMaxMs: round1(counters.snapshotMaxMs),
                } : null,
            } : null,
            rollback: counters ? {
                rollbacks: counters.rollbacks,
                meanDepth: round1(counters.rollbacks > 0
                    ? counters.rollbackDepthSum / counters.rollbacks : 0),
                maxDepth: counters.rollbackMaxDepth,
                events: { ...counters.events },
            } : null,
            env: this.env(),
        };
        this.lastSample = sample;
        (this.host.send ?? sendPerfSample)(JSON.stringify(sample), final);
        return sample;
    }

    private env(): PerfSample['env'] {
        const nav = typeof navigator !== 'undefined'
            ? navigator as Navigator & { deviceMemory?: number }
            : undefined;
        const view = this.host.app.view as { width?: number, height?: number };
        return {
            userAgent: (nav?.userAgent ?? '').slice(0, 400),
            renderer: this.renderer,
            devicePixelRatio: typeof devicePixelRatio === 'number'
                ? devicePixelRatio : 1,
            canvasWidth: Math.round(view.width ?? 0),
            canvasHeight: Math.round(view.height ?? 0),
            hardwareConcurrency: nav?.hardwareConcurrency ?? null,
            deviceMemoryGB: nav?.deviceMemory ?? null,
        };
    }
}

function isHidden(): boolean {
    return typeof document !== 'undefined' && document.hidden === true;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(value => {
            clearTimeout(timer);
            resolve(value);
        }, error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
