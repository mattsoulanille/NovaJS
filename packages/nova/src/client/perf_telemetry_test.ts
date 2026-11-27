import 'jasmine';
import { World } from 'nova_ecs/world';
import { PerfSample, PerfSampleType } from '../common/perf_stats.js';
import { SimulationPerfCounters } from '../communication/simulation_bridge_api.js';
import { RoomSpeedResource } from '../display/speed_indicator_plugin.js';
import type { ClientState } from './client_state.js';
import {
    LANDED_SAMPLE_MS, MIN_SYSTEM_WINDOW_MS, perfPhase, PerfTelemetry,
    PerfTelemetryHost, SPACE_SAMPLE_MS,
} from './perf_telemetry.js';

function counters(overrides: Partial<SimulationPerfCounters> = {}):
    SimulationPerfCounters {
    return {
        windowMs: 12000, stepCalls: 700, ticks: 720, stepMs: 1080,
        stepCallMaxMs: 9, snapshotCalls: 700, snapshotMs: 350,
        snapshotMaxMs: 2, rollbacks: 3, rollbackDepthSum: 9,
        rollbackMaxDepth: 5, events: { rollback: 3, holdForRelay: 2 },
        ...overrides,
    };
}

/** A fake page: a ticker that records its listeners, a controllable
 * clock, a client state, and a send that collects. */
function makeHarness() {
    let now = 0;
    let lastStart: number | undefined;
    const listeners: { fn: () => void, priority: number }[] = [];
    const sent: { body: string, final: boolean }[] = [];
    let enabled = true;
    const world = new World('perf telemetry');
    world.resources.set(RoomSpeedResource, {
        status: {
            speed: 2, targetSpeed: 2, atTick: 0, fastVotes: 2,
            totalVoters: 3, wantFast: true, inSpace: true,
        },
    });
    const perfCounters = jasmine.createSpy('perfCounters')
        .and.callFake(async () => counters());
    let state: ClientState = {
        kind: 'inSpace',
        system: { systemId: 'nova:130', world, bridge: { perfCounters } },
    } as unknown as ClientState;
    const host: PerfTelemetryHost = {
        app: {
            ticker: {
                add: (fn: () => void, _ctx: unknown, priority: number) => {
                    listeners.push({ fn, priority });
                },
                remove: (fn: () => void) => {
                    const i = listeners.findIndex(l => l.fn === fn);
                    if (i >= 0) {
                        listeners.splice(i, 1);
                    }
                },
            },
            renderer: {},
            view: { width: 1600, height: 1200 },
        } as never,
        state: () => state,
        buildVersion: 'build-1',
        enabled: () => enabled,
        send: (body, final) => { sent.push({ body, final }); },
        now: () => now,
    };
    const telemetry = new PerfTelemetry(host);
    return {
        telemetry, listeners, sent, perfCounters, world,
        advance(ms: number) { now += ms; lastStart = undefined; },
        get now() { return now; },
        setState(next: ClientState) { state = next; },
        setEnabled(value: boolean) { enabled = value; },
        /** One ticker frame starting `ms` after the last one started,
         * with its work split. */
        frame(ms: number, work = { display: 2, render: 4, other: 1 }) {
            now = lastStart === undefined ? now + ms : lastStart + ms;
            lastStart = now;
            telemetry.frameStartHook();
            now += work.display;
            telemetry.noteDisplayStep(work.display);
            now += work.other;
            telemetry.preRenderHook();
            now += work.render;
            telemetry.frameEndHook();
        },
        samples(): PerfSample[] {
            return sent.map(s => JSON.parse(s.body) as PerfSample);
        },
    };
}

/** Lets queued promise callbacks run. */
function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('PerfTelemetry', () => {
    it('maps client states to phases', () => {
        expect(perfPhase({ kind: 'inSpace' } as ClientState)).toBe('space');
        expect(perfPhase({ kind: 'landed' } as ClientState)).toBe('landed');
        expect(perfPhase({ kind: 'gateMap' } as ClientState)).toBe('landed');
        expect(perfPhase({ kind: 'transit' } as ClientState)).toBe('transit');
        expect(perfPhase({ kind: 'entering' } as ClientState))
            .toBe('transit');
    });

    it('installs three ticker hooks around the render and removes them',
        () => {
            const h = makeHarness();
            const dispose = h.telemetry.install();
            const priorities = h.listeners.map(l => l.priority)
                .sort((a, b) => b - a);
            // First of all, just before PIXI's render (LOW = -25), last.
            expect(priorities[0]).toBeGreaterThan(50);
            expect(priorities[1]).toBeGreaterThan(-25);
            expect(priorities[1]).toBeLessThan(0);
            expect(priorities[2]).toBeLessThan(-50);
            dispose();
            expect(h.listeners.length).toBe(0);
        });

    it('sends a valid sample with the worker\'s counters every ~12 s in space',
        async () => {
            const h = makeHarness();
            h.telemetry.tick();
            for (let i = 0; i < 600; i++) {
                h.frame(17);
                if (i % 2 === 0) {
                    h.telemetry.notePump(3, 1, 0.5);
                    h.telemetry.noteApply(1);
                }
            }
            h.frame(400, { display: 30, render: 200, other: 20 });
            h.telemetry.tick();
            expect(h.sent.length).toBe(0);
            h.advance(SPACE_SAMPLE_MS - h.now + 1);
            h.telemetry.tick();
            await settle();
            expect(h.perfCounters).toHaveBeenCalled();
            const [sample] = h.samples();
            expect(PerfSampleType.is(sample)).toBeTrue();
            expect(h.sent[0].final).toBeFalse();
            expect(sample.seq).toBe(0);
            expect(sample.build).toBe('build-1');
            expect(sample.system).toBe('nova:130');
            expect(sample.speed).toBe(2);
            expect(sample.playersInSpace).toBe(3);
            expect(sample.frames.count).toBe(600);
            expect(sample.frames.over100).toBe(1);
            expect(sample.stalls.length).toBe(1);
            expect(sample.stalls[0].ms).toBe(400);
            expect(sample.main.displayStepMeanMs).toBeGreaterThan(1.9);
            expect(sample.sim!.pumps).toBe(300);
            expect(sample.sim!.worker!.tickMeanMs).toBe(1.5);
            expect(sample.rollback).toEqual({
                rollbacks: 3, meanDepth: 3, maxDepth: 5,
                events: { rollback: 3, holdForRelay: 2 },
            });
            expect(sample.counts!.samples).toBe(3);
            expect(sample.env.canvasWidth).toBe(1600);
            expect(sample.sid).toBe(h.telemetry.sessionId);
        });

    it('measures the main thread split from the hooks', async () => {
        const h = makeHarness();
        h.frame(16, { display: 2, render: 5, other: 1 });
        h.frame(16, { display: 2, render: 5, other: 1 });
        await h.telemetry.flush(h.now, 'final');
        const [sample] = h.samples();
        expect(sample.main.displayStepMeanMs).toBe(2);
        expect(sample.main.renderMeanMs).toBe(5);
        expect(sample.main.otherMeanMs).toBe(1);
        expect(sample.main.tickerMeanMs).toBe(8);
        expect(sample.frames.count).toBe(1);
    });

    it('sends nothing, and keeps nothing, when switched off', async () => {
        const h = makeHarness();
        h.setEnabled(false);
        for (let i = 0; i < 100; i++) {
            h.frame(17);
        }
        h.telemetry.tick();
        await h.telemetry.flush(h.now, 'periodic');
        expect(h.sent.length).toBe(0);
        h.setEnabled(true);
        h.frame(17);
        h.frame(17);
        await h.telemetry.flush(h.now, 'final');
        expect(h.samples()[0].frames.count).toBe(2);
    });

    it('sends nothing for a window without a visible frame', async () => {
        const h = makeHarness();
        await h.telemetry.flush(h.now, 'periodic');
        expect(h.sent.length).toBe(0);
    });

    it('closes the window at a system change, without the next system\'s '
        + 'counters', async () => {
        const h = makeHarness();
        h.telemetry.tick();
        for (let i = 0; i < 300; i++) {
            h.frame(17);
            h.telemetry.notePump(3, 1, 0);
        }
        expect(h.now).toBeGreaterThan(MIN_SYSTEM_WINDOW_MS);
        h.setState({
            kind: 'inSpace',
            system: {
                systemId: 'nova:131', world: h.world,
                bridge: { perfCounters: h.perfCounters },
            },
        } as unknown as ClientState);
        h.telemetry.tick();
        await Promise.resolve();
        const [sample] = h.samples();
        expect(sample.system).toBe('nova:130');
        expect(sample.sim!.worker).toBeNull();
        expect(sample.rollback).toBeNull();
        expect(h.perfCounters).not.toHaveBeenCalled();
        // The next window is the new system's.
        h.frame(17);
        h.frame(17);
        await h.telemetry.flush(h.now, 'final');
        expect(h.samples()[1].system).toBe('nova:131');
        expect(h.samples()[1].seq).toBe(1);
    });

    it('runs a short visit on into the next window and counts the change',
        async () => {
            const h = makeHarness();
            h.telemetry.tick();
            h.frame(17);
            h.frame(17);
            h.setState({
                kind: 'inSpace',
                system: {
                    systemId: 'nova:131', world: h.world,
                    bridge: { perfCounters: h.perfCounters },
                },
            } as unknown as ClientState);
            h.telemetry.tick();
            expect(h.sent.length).toBe(0);
            await h.telemetry.flush(h.now, 'final');
            // `system` is where the window ended.
            expect(h.samples()[0].systemChanges).toBe(1);
            expect(h.samples()[0].system).toBe('nova:131');
        });

    it('samples landed windows every ~30 s, lighter', async () => {
        const h = makeHarness();
        const live = {
            systemId: 'nova:130', world: h.world,
            bridge: { perfCounters: h.perfCounters },
        };
        h.setState({ kind: 'landed', system: live } as unknown as ClientState);
        h.telemetry.tick();
        h.frame(17);
        h.frame(17);
        h.advance(SPACE_SAMPLE_MS);
        h.telemetry.tick();
        expect(h.sent.length).toBe(0);
        h.advance(LANDED_SAMPLE_MS - SPACE_SAMPLE_MS);
        h.telemetry.tick();
        await Promise.resolve();
        const [sample] = h.samples();
        expect(PerfSampleType.is(sample)).toBeTrue();
        expect(sample.landedMs).toBeGreaterThan(0);
        expect(sample.spaceMs).toBe(0);
        expect(sample.counts).toBeNull();
        expect(sample.sim).toBeNull();
    });

    it('sends the final window as a beacon, synchronously', () => {
        const h = makeHarness();
        h.frame(17);
        h.frame(17);
        h.telemetry.notePump(3, 1, 0);
        h.telemetry.flushFinal();
        expect(h.sent.length).toBe(1);
        expect(h.sent[0].final).toBeTrue();
        expect(h.samples()[0].sim!.worker).toBeNull();
    });

    it('goes without the worker\'s counters when the bridge fails', async () => {
        const h = makeHarness();
        h.perfCounters.and.callFake(async () => {
            throw new Error('closed');
        });
        h.frame(17);
        h.frame(17);
        h.telemetry.notePump(3, 1, 0);
        await h.telemetry.flush(h.now, 'periodic');
        expect(h.samples()[0].sim!.worker).toBeNull();
        expect(h.samples()[0].rollback).toBeNull();
    });

    it('allocates no per-frame objects in the hot hooks', () => {
        // Not a proof, a tripwire: the hooks are bound once, and the
        // window's storage is fixed at construction.
        const h = makeHarness();
        const start = h.telemetry.frameStartHook;
        const end = h.telemetry.frameEndHook;
        h.frame(17);
        expect(h.telemetry.frameStartHook).toBe(start);
        expect(h.telemetry.frameEndHook).toBe(end);
    });

    it('counts heartbeat-driven ticker updates apart from rAF frames', async () => {
        const h = makeHarness();
        h.frame(17);
        h.frame(17);
        // A stalled rAF: the heartbeat drives drawless updates.
        for (let i = 0; i < 5; i++) {
            h.advance(16);
            h.telemetry.beginHeartbeat();
            h.telemetry.frameStartHook();
            h.telemetry.noteDisplayStep(3);
            h.telemetry.preRenderHook();
            h.telemetry.frameEndHook();
            h.telemetry.endHeartbeat();
        }
        h.frame(17);
        await h.telemetry.flush(h.now, 'final');
        const [sample] = h.samples();
        expect(sample.frames.heartbeatUpdates).toBe(5);
        // The rAF interval spans the heartbeat updates: the second rAF
        // frame started at 17 ms, the next at 41 + 5 x 16 + 17 = 138.
        expect(sample.frames.count).toBe(2);
        expect(sample.frames.worstMs).toBe(138 - 34);
        // The heartbeat's display steps are not the rAF frames' work.
        expect(sample.main.displayStepMaxMs).toBe(2);
    });

    it('passes the worker\'s own batch ms and the snapshot gaps through',
        async () => {
            const h = makeHarness();
            const live = {};
            h.frame(17);
            h.telemetry.notePump(30, 4, 3, 20);
            h.telemetry.noteApply(1, live);
            h.advance(700);
            h.telemetry.noteApply(1, live);
            h.frame(17);
            await h.telemetry.flush(h.now, 'final');
            const [sample] = h.samples();
            expect(PerfSampleType.is(sample)).toBeTrue();
            expect(sample.sim!.stepReturnMsPerStep).toBe(5);
            expect(sample.sim!.stepsPerPumpMax).toBe(4);
            expect(sample.sim!.behindMaxTicks).toBe(3);
            expect(sample.main.snapshotGapsOver500).toBe(1);
        });
});
