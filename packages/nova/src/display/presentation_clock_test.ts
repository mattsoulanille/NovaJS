import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import {
    MovementPhysicsComponent, MovementStateComponent,
    MovementTimeLimitResource, MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { FixedTimestepResource, TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { advanceSimulationDebt } from '../client/frame_pump.js';
import {
    advanceDisplayClock, MovementExtrapolationPlugin, snapshotMaxLeadMs,
} from './movement_extrapolation_plugin.js';

const STEP_MS = 1000 / 60;
/** A steady 60 Hz screen. */
const FRAME_MS = 1000 / 60;
const SPEED_PX_S = 120;

/**
 * ============================================================================
 * THE SNAPSHOT -> DISPLAY HANDOFF, END TO END
 * ============================================================================
 *
 * The simulation steps whole ticks on the pump's time debt and its snapshot
 * reaches the display a round trip later; between snapshots the display
 * extrapolates on its own clock. Measured in the browser (and in the
 * maintainer's screen recording) at constant velocity:
 *
 * - at 2x, a frame worth 2 ticks often stepped 1 and the next 3, and each
 *   snapshot was drawn as if it were current: per-frame motion 0.5x then
 *   1.5x (recording: 0.46/1.57, 1.49/0.49, ...);
 * - a round trip that overran a frame (the worker busy resimulating a
 *   rollback) let the display extrapolate past the snapshot it was waiting
 *   for, which was then drawn as-is: a BACKWARD snap of the overrun frames,
 *   then a forward catch-up.
 *
 * This drives the real pieces — advanceSimulationDebt, the display world's
 * MovementSystem with its skip/lead rule, and the presentation clock — over
 * a ship coasting at constant velocity, and measures each display frame's
 * motion in frames of travel (1.0 = perfectly smooth).
 */
async function runHandoff(options: {
    speed: 1 | 2,
    frames: number,
    /** ms the pump's clock reading wandered from the frame's at frame k
     * (performance.now() read after the pump's awaits did). */
    wander?: (k: number) => number,
    /** Frames the round trip of the pump started at frame k takes. */
    roundTrip?: (k: number) => number,
    /** Simulation rate (slew included). */
    rate?: number,
    /** false: draw every snapshot as-is (the handoff before the clock). */
    compensate: boolean,
}): Promise<number[]> {
    const { speed, compensate } = options;
    const rate = options.rate ?? speed;
    const world = new World('handoff display');
    await world.addPlugin(TimePlugin);
    // The display's scaled wall clock, pinned to the frame interval.
    world.resources.set(FixedTimestepResource, { delta_ms: FRAME_MS * rate });
    await world.addPlugin(MovementExtrapolationPlugin);
    const limit = world.resources.get(MovementTimeLimitResource)!;
    limit.maxDeltaMs = 100 * speed;
    const physics = {
        maxVelocity: 300, turnRate: 1, acceleration: 100,
        movementType: MovementType.INERTIAL,
    } as const;
    const simState = (tick: number) => ({
        position: new Position(SPEED_PX_S * tick * STEP_MS / 1000, 0),
        velocity: new Vector(SPEED_PX_S, 0),
        rotation: new Angle(0), turning: 0, turnBack: false, accelerating: 0,
    });
    const ship = new Entity('ship')
        .addComponent(MovementStateComponent, simState(0))
        .addComponent(MovementPhysicsComponent, physics);
    world.entities.set('ship', ship);

    let simTick = 0;
    let debt = 0;
    let lastPumpClock: number | undefined;
    let inFlight: { landsAt: number, tick: number, pumpFrameMs: number,
        debtMs: number } | undefined;
    let displaySim: number | undefined = 0;
    let previousFrameMs: number | undefined;
    const xs: number[] = [];
    for (let k = 0; k < options.frames; k++) {
        const frameMs = k * FRAME_MS;
        // The round trip's snapshot lands between frames, before this one.
        let landed: typeof inFlight;
        if (inFlight && inFlight.landsAt <= k) {
            landed = inFlight;
            inFlight = undefined;
            ship.components.set(MovementStateComponent, simState(landed.tick));
        }
        const clock = advanceDisplayClock({
            previousSimTimeMs: displaySim,
            frameDeltaMs: previousFrameMs === undefined ? 0
                : frameMs - previousFrameMs,
            rate,
            snapshot: landed && {
                simTimeMs: landed.tick * STEP_MS,
                maxLeadMs: snapshotMaxLeadMs({
                    debtMs: landed.debtMs, pumpFrameMs: landed.pumpFrameMs,
                    previousFrameMs: previousFrameMs ?? frameMs, rate,
                }),
            },
        });
        displaySim = clock.simTimeMs;
        previousFrameMs = frameMs;
        limit.skipUuids = new Set(landed ? ['ship'] : []);
        limit.syncedLeadMs = compensate ? clock.syncedLeadMs : 0;
        world.step();
        xs.push(ship.components.get(MovementStateComponent)!.position.x);

        // The pump: one round trip at a time.
        if (!inFlight) {
            const pumpClock = frameMs + (options.wander?.(k) ?? 0);
            const elapsedMs = lastPumpClock === undefined ? 0
                : pumpClock - lastPumpClock;
            lastPumpClock = pumpClock;
            const next = advanceSimulationDebt({
                timeDebt: debt, elapsedMs, paused: false, pendingSteps: 0,
                pacing: { rate, behindTicks: 0, speed },
            });
            debt = next.timeDebt;
            if (next.steps > 0) {
                simTick += next.steps;
                inFlight = {
                    landsAt: k + (options.roundTrip?.(k) ?? 1),
                    tick: simTick, pumpFrameMs: frameMs, debtMs: debt,
                };
            }
        }
    }
    const perFrame = SPEED_PX_S * FRAME_MS / 1000 * rate;
    // Skip the start-up frames (no snapshot yet, the first pump).
    return xs.slice(1).map((x, i) => (x - xs[i]) / perFrame).slice(8);
}

/** A deterministic ±amplitude wander. */
function wander(amplitude: number) {
    let seed = 7;
    const values: number[] = [];
    return (k: number) => {
        while (values.length <= k) {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            values.push((seed / 2147483648 * 2 - 1) * amplitude);
        }
        return values[k];
    };
}

const uneven = (motion: number[]) =>
    motion.filter(m => m < 0.75 || m > 1.25).length;
const backward = (motion: number[]) => motion.filter(m => m < 0).length;

describe('snapshot -> display handoff (presentation clock)', () => {
    describe('at 2x, with the pump clock wandering about the frame '
        + 'clock (performance.now() after awaits)', () => {
        it('drew 0.5x / 1.5x frames when each snapshot was drawn as-is',
            async () => {
                const motion = await runHandoff({
                    speed: 2, frames: 600, wander: wander(1),
                    compensate: false,
                });
                expect(uneven(motion)).toBeGreaterThan(20);
                expect(Math.min(...motion)).toBeLessThan(0.6);
                expect(Math.max(...motion)).toBeGreaterThan(1.4);
            });

        it('draws no short frame once a stale snapshot is advanced to '
            + 'the display clock', async () => {
                const motion = await runHandoff({
                    speed: 2, frames: 600, wander: wander(1),
                    compensate: true,
                });
                // The wandering debt still mis-times a crossing by a
                // fraction of a tick; nothing is half a frame short.
                expect(Math.min(...motion)).toBeGreaterThan(0.9);
                expect(backward(motion)).toBe(0);
            });
    });

    describe('with the pump and the display on one even frame clock', () => {
        for (const speed of [1, 2] as const) {
            it(`moves every frame by one frame of travel at ${speed}x`,
                async () => {
                    const motion = await runHandoff({
                        speed, frames: 600, compensate: true,
                    });
                    expect(uneven(motion)).toBe(0);
                });

            it(`crosses a tick boundary of the pacing slew with at most one `
                + `uneven frame per crossing at ${speed}x`, async () => {
                    // 0.5% fast: the debt gains a tick every
                    // 1 / (0.005 * speed) frames.
                    const rate = speed * 1.005;
                    const motion = await runHandoff({
                        speed, frames: 600, rate, compensate: true,
                    });
                    expect(backward(motion)).toBe(0);
                    expect(uneven(motion))
                        .toBeLessThanOrEqual(Math.ceil(600 * 0.005 * speed));
                });
        }
    });

    describe('a round trip that overruns frames (worker busy)', () => {
        // Every 60th pump's reply takes 4 frames instead of 1.
        const stalls = (k: number) => (k % 60 === 30 ? 4 : 1);

        for (const speed of [1, 2] as const) {
            it(`snapped backward when the late snapshot was drawn as-is `
                + `(${speed}x)`, async () => {
                    const motion = await runHandoff({
                        speed, frames: 600, roundTrip: stalls,
                        compensate: false,
                    });
                    expect(backward(motion)).toBeGreaterThan(0);
                    expect(Math.min(...motion)).toBeLessThan(-1.5);
                });

            it(`never moves backward with the presentation clock (${speed}x)`,
                async () => {
                    const motion = await runHandoff({
                        speed, frames: 600, roundTrip: stalls,
                        compensate: true,
                    });
                    expect(backward(motion)).toBe(0);
                    // The frames the stall held stay at one frame each;
                    // the catch-up pump lands exactly on the clock.
                    expect(Math.min(...motion)).toBeGreaterThan(0.95);
                    expect(Math.max(...motion)).toBeLessThan(1.05);
                });
        }
    });
});

describe('advanceDisplayClock', () => {
    it('adopts an on-time snapshot exactly (lead 0)', () => {
        expect(advanceDisplayClock({
            previousSimTimeMs: 1000, frameDeltaMs: FRAME_MS, rate: 1,
            snapshot: { simTimeMs: 1000 + STEP_MS, maxLeadMs: 10 },
        })).toEqual({ simTimeMs: 1000 + STEP_MS, syncedLeadMs: 0 });
    });

    it('jumps forward to a snapshot ahead of it (a catch-up)', () => {
        expect(advanceDisplayClock({
            previousSimTimeMs: 1000, frameDeltaMs: FRAME_MS, rate: 1,
            snapshot: { simTimeMs: 1000 + 3 * STEP_MS, maxLeadMs: 10 },
        }).syncedLeadMs).toBe(0);
    });

    it('advances a stale snapshot to the clock, bounded by maxLeadMs', () => {
        const stale = advanceDisplayClock({
            previousSimTimeMs: 1000, frameDeltaMs: FRAME_MS, rate: 2,
            snapshot: { simTimeMs: 1000 + STEP_MS, maxLeadMs: STEP_MS },
        });
        expect(stale.syncedLeadMs).toBeCloseTo(STEP_MS, 9);
        expect(stale.simTimeMs!).toBeCloseTo(1000 + 2 * STEP_MS, 9);
        const bounded = advanceDisplayClock({
            previousSimTimeMs: 1000, frameDeltaMs: 5 * FRAME_MS, rate: 1,
            snapshot: { simTimeMs: 1000, maxLeadMs: 7 },
        });
        expect(bounded).toEqual({ simTimeMs: 1007, syncedLeadMs: 7 });
    });

    it('anchors on the first snapshot and keeps running without one', () => {
        expect(advanceDisplayClock({
            previousSimTimeMs: undefined, frameDeltaMs: FRAME_MS, rate: 1,
            snapshot: { simTimeMs: 500, maxLeadMs: 10 },
        })).toEqual({ simTimeMs: 500, syncedLeadMs: 0 });
        expect(advanceDisplayClock({
            previousSimTimeMs: 500, frameDeltaMs: 10, rate: 2,
        })).toEqual({ simTimeMs: 520, syncedLeadMs: 0 });
    });

    it('snapshotMaxLeadMs: the carried debt plus the frames the round trip '
        + 'overran', () => {
            // Landed on time: only the unstepped debt.
            expect(snapshotMaxLeadMs({
                debtMs: 4, pumpFrameMs: 100, previousFrameMs: 100, rate: 2,
            })).toBe(4);
            // Two frames late at 2x.
            expect(snapshotMaxLeadMs({
                debtMs: 4, pumpFrameMs: 100, previousFrameMs: 100 + 2 * FRAME_MS,
                rate: 2,
            })).toBeCloseTo(4 + 4 * FRAME_MS, 9);
        });
});
