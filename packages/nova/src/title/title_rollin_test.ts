import 'jasmine';
import {
    EMBLEM_ALPHA_MAX, initialSlideIndices, MAC_TICK_MS, nextLogoFrame,
    RollInCue, SLIDE_ROWS, TickClock, TitleRollIn,
} from './title_rollin.js';

/** Runs ticks until the roll-in finishes; cues keyed by tick (1-based). */
function runToEnd(rollIn: TitleRollIn, limit = 100) {
    const cues: [number, RollInCue[]][] = [];
    let tick = 0;
    while (!rollIn.finished && tick < limit) {
        tick++;
        const raised = rollIn.tick();
        if (raised.length) {
            cues.push([tick, raised]);
        }
    }
    return { cues, ticks: tick };
}

describe('title roll-in', () => {
    it('starts the rows at -1, -6 and -11 (half a row apart)', () => {
        // LoadMainScreenAnim: -1, trunc(-1 + 11 * -0.5), trunc(-6 + 10 * -0.5).
        expect(initialSlideIndices([11, 10, 11])).toEqual([-1, -6, -11]);
        // Truncation is toward zero, not floor.
        expect(initialSlideIndices([1, 3, 3])).toEqual([-1, -1, -2]);
    });

    it('uses the original strips: 11, 10 and 11 frames', () => {
        expect(SLIDE_ROWS.map(row => row.frames)).toEqual([11, 10, 11]);
        expect(SLIDE_ROWS.map(row => row.pict))
            .toEqual(['nova:8030', 'nova:8031', 'nova:8032']);
    });

    it('raises 602 as each row starts and 603 as it lands, on the '
        + 'original\'s ticks', () => {
        const { cues } = runToEnd(new TitleRollIn());
        expect(cues).toEqual([
            [2, [{ kind: 'start', row: 0 }]],
            [7, [{ kind: 'start', row: 1 }]],
            [12, [{ kind: 'end', row: 0 }, { kind: 'start', row: 2 }]],
            [16, [{ kind: 'end', row: 1 }]],
            [22, [{ kind: 'end', row: 2 }]],
        ]);
    });

    it('shows each row hidden, then its strip frame by frame, then its '
        + 'buttons', () => {
        const rollIn = new TitleRollIn();
        expect(rollIn.row(0)).toEqual({ kind: 'hidden' });
        rollIn.tick(); // 1
        expect(rollIn.row(0)).toEqual({ kind: 'slide', frame: 0 });
        expect(rollIn.row(1)).toEqual({ kind: 'hidden' });
        for (let t = 2; t <= 6; t++) {
            rollIn.tick();
        }
        // Tick 6: the upper strip is on frame 5, the middle one appears.
        expect(rollIn.row(0)).toEqual({ kind: 'slide', frame: 5 });
        expect(rollIn.row(1)).toEqual({ kind: 'slide', frame: 0 });
        expect(rollIn.row(2)).toEqual({ kind: 'hidden' });
        for (let t = 7; t <= 12; t++) {
            rollIn.tick();
        }
        // Tick 12: the upper row has landed (its buttons now draw).
        expect(rollIn.row(0)).toEqual({ kind: 'buttons' });
        expect(rollIn.row(1)).toEqual({ kind: 'slide', frame: 6 });
        expect(rollIn.row(2)).toEqual({ kind: 'slide', frame: 1 });
    });

    it('keeps the emblem hidden until every row lands, then fades it '
        + 'in 4/32 a tick', () => {
        const rollIn = new TitleRollIn();
        const opacity: number[] = [];
        for (let t = 1; t <= 30; t++) {
            rollIn.tick();
            opacity.push(rollIn.emblemOpacity);
        }
        // Ticks 1-21: hidden. 22 (the last landing): 4/32 ... 29: full.
        expect(opacity.slice(0, 21).every(o => o === 0)).toBeTrue();
        expect(opacity.slice(21, 29)).toEqual(
            [4, 8, 12, 16, 20, 24, 28, 32].map(a => a / EMBLEM_ALPHA_MAX));
        expect(opacity[29]).toBe(1);
        expect(rollIn.finished).toBeTrue();
    });

    it('takes 22 ticks (about 0.37 s) to land every row', () => {
        const rollIn = new TitleRollIn();
        let ticks = 0;
        while (!rollIn.rowsDone) {
            rollIn.tick();
            ticks++;
        }
        expect(ticks).toBe(22);
        expect(ticks * MAC_TICK_MS).toBeCloseTo(365.7, 0);
    });

    it('a click skips: every row lands at once, with no end sound', () => {
        const rollIn = new TitleRollIn();
        for (let t = 1; t <= 8; t++) {
            rollIn.tick();
        }
        expect(rollIn.skip()).toBeTrue();
        expect([0, 1, 2].map(i => rollIn.row(i).kind))
            .toEqual(['buttons', 'buttons', 'buttons']);
        // No further cues; the emblem still fades in from nothing.
        expect(rollIn.emblemOpacity).toBe(0);
        const { cues, ticks } = runToEnd(rollIn);
        expect(cues).toEqual([]);
        expect(ticks).toBe(8);
        // A skip once everything has landed reports nothing to skip.
        expect(rollIn.skip()).toBeFalse();
    });

    it('in the background there is no roll-in at all', () => {
        const rollIn = new TitleRollIn(SLIDE_ROWS, true);
        expect(rollIn.finished).toBeTrue();
        expect(rollIn.emblemOpacity).toBe(1);
        expect(rollIn.row(2)).toEqual({ kind: 'buttons' });
        expect(rollIn.tick()).toEqual([]);
    });
});

describe('title roll-in tick clock', () => {
    it('turns frame time into whole Mac ticks, carrying the remainder',
        () => {
            const clock = new TickClock(10);
            expect(clock.advance(4)).toBe(0);
            expect(clock.advance(7)).toBe(1);
            expect(clock.advance(9)).toBe(1);
            expect(clock.advance(20)).toBe(2);
        });

    it('caps a long stall instead of bursting', () => {
        const clock = new TickClock(10, 4);
        expect(clock.advance(1000)).toBe(4);
        // The rest was dropped, not queued.
        expect(clock.advance(5)).toBe(0);
    });

    it('ignores negative deltas', () => {
        const clock = new TickClock(10);
        expect(clock.advance(-50)).toBe(0);
        expect(clock.advance(10)).toBe(1);
    });
});

describe('title logo flicker', () => {
    it('never repeats the current frame and reaches every other one', () => {
        for (let current = 0; current < 7; current++) {
            const seen = new Set<number>();
            for (let i = 0; i < 6; i++) {
                // Evenly spaced draws over [0, 1).
                seen.add(nextLogoFrame(current, 7, () => (i + 0.5) / 6));
            }
            expect(seen.has(current)).toBeFalse();
            expect(seen.size).toBe(6);
        }
    });

    it('stays in range at the edges of the draw', () => {
        expect(nextLogoFrame(6, 7, () => 0.999999)).toBe(5);
        expect(nextLogoFrame(0, 7, () => 0)).toBe(1);
        expect(nextLogoFrame(3, 7, () => 0.9999999999)).toBe(6);
        expect(nextLogoFrame(0, 1, () => 0.5)).toBe(0);
    });
});
