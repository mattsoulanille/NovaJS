import 'jasmine';
import { MovementTimeLimitResource } from 'nova_ecs/plugins/movement_plugin';
import { TimePlugin, TimeResource, TimeScaleResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { MAX_EXTRAPOLATION_DELTA_MS } from '../display/movement_extrapolation_plugin.js';
import { SIMULATION_STEP_MS } from '../nova_plugin/make_system.js';
import { advanceSimulationDebt, applyDisplaySpeed } from './frame_pump.js';

describe('advanceSimulationDebt (#371 R1)', () => {
    it('advances 1 step per frame at 1x and 2 steps per frame at 2x', () => {
        const at1x = advanceSimulationDebt({
            timeDebt: 0,
            elapsedMs: SIMULATION_STEP_MS,
            paused: false,
            pendingSteps: 0,
            pacing: { rate: 1, behindTicks: 0, speed: 1 },
        });
        expect(at1x.steps).toBe(1);

        const at2x = advanceSimulationDebt({
            timeDebt: 0,
            elapsedMs: SIMULATION_STEP_MS,
            paused: false,
            pendingSteps: 0,
            pacing: { rate: 2, behindTicks: 0, speed: 2 },
        });
        expect(at2x.steps).toBe(2);
    });

    it('scales the per-frame catch-up cap with room speed so wall-time budget stays 100ms', () => {
        // A 500ms stall exceeds MAX_CATCHUP_STEPS (6 at 1x -> 12 at 2x).
        const stall1x = advanceSimulationDebt({
            timeDebt: 0,
            elapsedMs: 500,
            paused: false,
            pendingSteps: 0,
            pacing: { rate: 1, behindTicks: 0, speed: 1 },
        });
        expect(stall1x.steps).toBe(6);

        const stall2x = advanceSimulationDebt({
            timeDebt: 0,
            elapsedMs: 500,
            paused: false,
            pendingSteps: 0,
            pacing: { rate: 2, behindTicks: 0, speed: 2 },
        });
        expect(stall2x.steps).toBe(12);
    });

    it('scales the hard-snap threshold and cap with room speed', () => {
        // 45 ticks behind is past SNAP_BEHIND_TICKS at 1x (30), so 1x snaps...
        const snap1x = advanceSimulationDebt({
            timeDebt: 0,
            elapsedMs: SIMULATION_STEP_MS,
            paused: false,
            pendingSteps: 0,
            pacing: { rate: 1.05, behindTicks: 45, speed: 1 },
        });
        expect(snap1x.steps).toBe(1 + 45);

        // ...but at 2x, 45 ticks is only 375ms (< 500ms = 60 ticks), so 2x
        // slews smoothly without a hard snap.
        const slew2x = advanceSimulationDebt({
            timeDebt: 0,
            elapsedMs: SIMULATION_STEP_MS,
            paused: false,
            pendingSteps: 0,
            pacing: { rate: 2.1, behindTicks: 45, speed: 2 },
        });
        expect(slew2x.steps).toBe(2);

        // Gross divergence at 2x snaps up to HARD_CATCHUP_STEPS * 2 (120).
        const hardSnap2x = advanceSimulationDebt({
            timeDebt: 0,
            elapsedMs: SIMULATION_STEP_MS,
            paused: false,
            pendingSteps: 0,
            pacing: { rate: 2.1, behindTicks: 500, speed: 2 },
        });
        expect(hardSnap2x.steps).toBe(2 + 120);
    });
});

describe('advanceSimulationDebt: the eager snap after an entry', () => {
    const frame = (behindTicks: number, speed: 1 | 2, eagerSnap?: boolean) =>
        advanceSimulationDebt({
            timeDebt: 0,
            elapsedMs: SIMULATION_STEP_MS,
            paused: false,
            pendingSteps: 0,
            pacing: { rate: speed * 1.05, behindTicks, speed },
            eagerSnap,
        });

    it('steps a small post-entry drift at once instead of slewing it', () => {
        // 12 ticks behind: steady state slews (1 step this frame) ...
        expect(frame(12, 1).steps).toBe(1);
        // ... while just after an entry (or docked) it is stepped now.
        expect(frame(12, 1, true).steps).toBe(1 + 12);
    });

    it('leaves the steady-state jitter of a tick or two to the slew', () => {
        expect(frame(2, 1, true).steps).toBe(1);
        expect(frame(-3, 1, true).steps).toBe(1);
    });

    it('scales its threshold and cap with the room speed', () => {
        // 4 ticks at 2x is the same ~33 ms as 2 at 1x: no snap.
        expect(frame(4, 2, true).steps).toBe(2);
        expect(frame(9, 2, true).steps).toBe(2 + 9);
        // Bounded per frame like the steady-state snap.
        expect(frame(500, 1, true).steps).toBe(1 + 60);
        expect(frame(500, 2, true).steps).toBe(2 + 120);
    });
});

describe('applyDisplaySpeed (#371 R2)', () => {
    it('runs display world TimeResource and movement clamp at 2x when fast', async () => {
        jasmine.clock().install();
        try {
            jasmine.clock().mockDate(new Date(5000));
            const displayWorld = new World('display speed test');
            await displayWorld.addPlugin(TimePlugin);
            displayWorld.resources.set(TimeScaleResource, { scale: 1 });
            displayWorld.resources.set(MovementTimeLimitResource, {
                enabled: true,
                maxDeltaMs: MAX_EXTRAPOLATION_DELTA_MS,
            });

            // At 2x, 50ms wall time advances display TimeResource by 100ms
            // (driving explosions, particles, sprite animations, and engine glow at 2x).
            applyDisplaySpeed(displayWorld, 2);
            expect(displayWorld.resources.get(MovementTimeLimitResource)!.maxDeltaMs)
                .toBe(MAX_EXTRAPOLATION_DELTA_MS * 2);

            jasmine.clock().tick(50);
            displayWorld.step();
            const timeAt2x = displayWorld.resources.get(TimeResource)!;
            expect(timeAt2x.delta_ms).toBe(100);
            expect(timeAt2x.delta_s).toBeCloseTo(0.1, 6);
            expect(timeAt2x.time).toBe(5100);

            // Returning to 1x restores 1x delta and clamp while keeping time monotonic.
            applyDisplaySpeed(displayWorld, 1);
            expect(displayWorld.resources.get(MovementTimeLimitResource)!.maxDeltaMs)
                .toBe(MAX_EXTRAPOLATION_DELTA_MS);

            jasmine.clock().tick(50);
            displayWorld.step();
            const timeBack1x = displayWorld.resources.get(TimeResource)!;
            expect(timeBack1x.delta_ms).toBe(50);
            expect(timeBack1x.time).toBe(5150);
        } finally {
            jasmine.clock().uninstall();
        }
    });
});
