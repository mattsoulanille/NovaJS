import 'jasmine';
import { accelRating, turnRating } from './ship_info.js';

/**
 * The ship-info Accel / Turn words against the original's twenty kit hulls
 * (reference "Ship-info rating words (E11), wave 40": Accel 50 k, Turn
 * 5 k for k = 1..20), plus the two stock captures the bands were first
 * calibrated on (Shuttle 500 / 40 Good / Good, IDA Frigate 275 / 30
 * Average / Average).
 */
describe('ship info rating words (E11, wave 40)', () => {
    const measured: [number, string, string][] = [
        // [k, Accel word, Turn word]
        [1, 'Terrible', 'Terrible'], [2, 'Terrible', 'Terrible'],
        [3, 'Poor', 'Poor'], [4, 'Poor', 'Poor'],
        [5, 'Average', 'Average'], [6, 'Average', 'Average'],
        [7, 'Average', 'Good'],
        [8, 'Good', 'Good'],
        [9, 'Good', 'Very Good'], [10, 'Good', 'Very Good'],
        [11, 'Good', 'Excellent'],
        [12, 'Very Good', 'Excellent'], [13, 'Very Good', 'Excellent'],
        [14, 'Very Good', 'Excellent'],
        ...[15, 16, 17, 18, 19, 20].map(k =>
            [k, 'Excellent', 'Excellent'] as [number, string, string]),
    ];

    for (const [k, accel, turn] of measured) {
        it(`reads Accel ${50 * k} as ${accel} and Turn ${5 * k} as ${turn}`,
            () => {
                expect(accelRating(50 * k)).toBe(accel);
                expect(turnRating(5 * k)).toBe(turn);
            });
    }

    it('keeps the stock captures', () => {
        expect(accelRating(500)).toBe('Good');
        expect(turnRating(40)).toBe('Good');
        expect(accelRating(275)).toBe('Average');
        expect(turnRating(30)).toBe('Average');
    });

    it('calls the bottom band Terrible, never Feeble', () => {
        expect(accelRating(0)).toBe('Terrible');
        expect(turnRating(0)).toBe('Terrible');
    });
});

/**
 * The finer edges (reference "Ship-info rating edges (E11 leftover), wave
 * 41"): Turn on a 1-wide grid, Accel on 10- and 2-wide grids around each
 * edge. Every value the original was read at is checked; the odd Accel
 * values (129 / 249 / 381 / 551 / 731) were not built, and NovaJS puts the
 * edge there (GUESS).
 */
describe('ship info rating edges (E11, wave 41)', () => {
    const turnWords = ['Poor', 'Average', 'Good', 'Very Good', 'Excellent'];
    turnWords.forEach((word, i) => {
        const edge = 10 * (i + 1);
        it(`reads Turn ${edge} as the band below and ${edge + 1}-${edge + 4} as ${word}`,
            () => {
                expect(turnRating(edge)).toBe(i === 0 ? 'Terrible' : turnWords[i - 1]);
                for (let t = edge + 1; t <= edge + 4; t++) {
                    expect(turnRating(t)).toBe(word);
                }
            });
    });

    // [Accel, word] pairs read in the original (passes 1 and 2).
    const accel: [number, string][] = [
        ...[110, 120, 122, 124, 126, 128].map(a => [a, 'Terrible'] as [number, string]),
        ...[130, 140, 210, 220, 230, 240, 242, 244, 246, 248]
            .map(a => [a, 'Poor'] as [number, string]),
        ...[250, 360, 370, 380].map(a => [a, 'Average'] as [number, string]),
        ...[382, 384, 386, 388, 390, 550].map(a => [a, 'Good'] as [number, string]),
        ...[552, 554, 556, 558, 560, 570, 580, 590, 710, 720, 730]
            .map(a => [a, 'Very Good'] as [number, string]),
        ...[732, 734, 736, 738, 740].map(a => [a, 'Excellent'] as [number, string]),
    ];
    for (const [a, word] of accel) {
        it(`reads Accel ${a} as ${word}`, () => {
            expect(accelRating(a)).toBe(word);
        });
    }

    // The odd values (reference "Ship-info Accel at the odd values (E11
    // leftover), wave 42").
    const odd: [number, string][] = [
        [129, 'Terrible'], [249, 'Poor'], [381, 'Good'], [551, 'Very Good'],
        [731, 'Excellent'],
    ];
    for (const [a, word] of odd) {
        it(`reads the odd Accel ${a} as ${word} (wave 42)`, () => {
            expect(accelRating(a)).toBe(word);
        });
    }
});
