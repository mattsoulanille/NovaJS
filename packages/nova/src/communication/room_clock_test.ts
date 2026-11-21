import 'jasmine';
import { SIMULATION_STEP_MS } from '../nova_plugin/make_system.js';
import { RoomClock } from './room_clock.js';

describe('RoomClock', () => {
    it('extrapolates at 1x by default and switches at the exact atTick boundary', () => {
        const clock = new RoomClock();
        // Server at tick 100, announcing 2x effective at tick 105.
        clock.setSpeed({
            speed: 2, atTick: 105, fastVotes: 2, totalVoters: 2,
        }, 100, 1000);

        expect(clock.speedAt(100)).toBe(1);
        expect(clock.speedAt(104)).toBe(1);
        expect(clock.speedAt(105)).toBe(2);
        expect(clock.speedAt(200)).toBe(2);

        // Before the boundary: 3 steps at 1x -> tick 103.
        expect(clock.estimatedServerTick(1000 + 3 * SIMULATION_STEP_MS))
            .toBeCloseTo(103, 6);
        // Exactly at the boundary: 5 steps at 1x -> tick 105.
        expect(clock.estimatedServerTick(1000 + 5 * SIMULATION_STEP_MS))
            .toBeCloseTo(105, 6);
        // After the boundary: 5 steps at 1x + 4 steps at 2x -> 105 + 8 = 113.
        expect(clock.estimatedServerTick(1000 + 9 * SIMULATION_STEP_MS))
            .toBeCloseTo(113, 6);
    });

    it('extrapolates piecewise-linearly across a 2x -> 1x slowdown at atTick', () => {
        const clock = new RoomClock();
        // Server at tick 200 (running 2x), announcing 1x effective at tick 206.
        clock.setSpeed({
            speed: 1, atTick: 206, fastVotes: 1, totalVoters: 2,
        }, 200, 5000);

        expect(clock.speedAt(205)).toBe(2);
        expect(clock.speedAt(206)).toBe(1);

        // 6 ticks at 2x take 3 * SIMULATION_STEP_MS.
        expect(clock.estimatedServerTick(5000 + 1.5 * SIMULATION_STEP_MS))
            .toBeCloseTo(203, 6);
        expect(clock.estimatedServerTick(5000 + 3 * SIMULATION_STEP_MS))
            .toBeCloseTo(206, 6);
        // 4 more steps at 1x -> 210.
        expect(clock.estimatedServerTick(5000 + 7 * SIMULATION_STEP_MS))
            .toBeCloseTo(210, 6);
    });

    it('paces around 1x before atTick and around 2x from atTick onward', () => {
        const clock = new RoomClock();
        clock.setSpeed({
            speed: 2, atTick: 105, fastVotes: 1, totalVoters: 1,
        }, 100, 0);

        // At localTick 104 (with server at 100, 4 ticks lead): base speed is 1.
        const before = clock.pacing(104, 0)!;
        expect(before.speed).toBe(1);
        expect(before.behindTicks).toBeCloseTo(0, 6);
        expect(before.rate).toBeCloseTo(1, 6);

        // At localTick 105 (at boundary, server at 105): base speed switches to 2
        // and send-ahead lead scales to 8 ticks (same ~67 ms wall-clock margin).
        clock.resetDrift();
        const atBoundary = clock.pacing(113, 5 * SIMULATION_STEP_MS)!;
        expect(atBoundary.speed).toBe(2);
        expect(atBoundary.behindTicks).toBeCloseTo(0, 6);
        expect(atBoundary.rate).toBeCloseTo(2, 6);
    });

    it('keeps running at 2x across subsequent tickSync messages', () => {
        const clock = new RoomClock();
        clock.setSpeed({
            speed: 2, atTick: 50, fastVotes: 1, totalVoters: 1,
        }, 50, 0);
        clock.sync(170, 1000);
        expect(clock.estimatedServerTick(1000 + 10 * SIMULATION_STEP_MS))
            .toBeCloseTo(190, 6);
        expect(clock.speedAt(170)).toBe(2);
    });
});
