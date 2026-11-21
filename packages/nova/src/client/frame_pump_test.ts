import 'jasmine';
import { SIMULATION_STEP_MS } from '../nova_plugin/make_system.js';
import { advanceSimulationDebt } from './frame_pump.js';

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
