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

    describe('behindTicks', () => {
        it('is the drift pacing() reports, raw and without touching its '
            + 'smoothing', () => {
            const clock = new RoomClock();
            expect(clock.behindTicks(0, 0)).toBeUndefined();
            clock.sync(100, 0);
            // Server 100 + 4-tick lead - local 80.
            expect(clock.behindTicks(80, 0)).toBeCloseTo(24, 6);
            // Reading it twice changes nothing; pacing() then smooths
            // from scratch (its first reading IS the raw drift).
            expect(clock.behindTicks(80, 0)).toBeCloseTo(24, 6);
            const pacing = clock.pacing(80, 0)!;
            expect(pacing.behindTicks).toBeCloseTo(24, 6);
            expect(pacing.rate).toBeCloseTo(1.05, 6);
            // Ahead of the target: negative.
            expect(clock.behindTicks(110, 0)).toBeCloseTo(-6, 6);
        });

        it('scales the send-ahead lead with the room speed', () => {
            const clock = new RoomClock();
            clock.setSpeed({
                speed: 2, atTick: 0, fastVotes: 1, totalVoters: 1,
            }, 200, 0);
            // 200 + 8-tick lead at 2x - 190, then 2 ticks per step.
            expect(clock.behindTicks(190, 0)).toBeCloseTo(18, 6);
            expect(clock.behindTicks(190, 3 * SIMULATION_STEP_MS))
                .toBeCloseTo(24, 6);
        });
    });

    describe('late syncs', () => {
        const at = (tick: number) => tick * SIMULATION_STEP_MS;

        it('ignores a sync that arrived late: the estimate never drops '
            + 'for a delayed message', () => {
            const clock = new RoomClock();
            clock.sync(60, at(60));
            // The tick-120 sync sat 12 ticks in a busy event loop.
            clock.sync(120, at(132));
            expect(clock.estimatedServerTick(at(132))).toBeCloseTo(132, 6);
            // And the next timely one changes nothing either.
            clock.sync(180, at(180));
            expect(clock.estimatedServerTick(at(190))).toBeCloseTo(190, 6);
        });

        it('takes a sync that shows the clock further on (an earlier '
            + 'anchor was late)', () => {
            const clock = new RoomClock();
            // A join reply that arrived 24 ticks after it was sent.
            clock.sync(100, at(124));
            expect(clock.estimatedServerTick(at(160))).toBeCloseTo(136, 6);
            clock.sync(160, at(160));
            expect(clock.estimatedServerTick(at(160))).toBeCloseTo(160, 6);
        });

        it('forgets late anchors after the window, so a server that runs '
            + 'slow is followed', () => {
            const clock = new RoomClock();
            clock.sync(0, 0);
            // From here the server's clock runs 10 ticks behind the
            // extrapolation; within the window the early anchor wins ...
            clock.sync(50, at(60));
            expect(clock.estimatedServerTick(at(60))).toBeCloseTo(60, 6);
            // ... and once it ages out the slower clock is the estimate.
            clock.sync(290, at(300));
            expect(clock.estimatedServerTick(at(300))).toBeCloseTo(290, 6);
        });

        it('takes a far-lower clock at once (a new timeline, not a late '
            + 'message), and reset() forgets everything', () => {
            const clock = new RoomClock();
            clock.sync(5000, 0);
            clock.sync(10, at(10));
            expect(clock.estimatedServerTick(at(10))).toBeCloseTo(10, 6);
            clock.reset();
            expect(clock.estimatedServerTick(at(10))).toBeUndefined();
        });
    });
});
