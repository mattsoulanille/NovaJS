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
