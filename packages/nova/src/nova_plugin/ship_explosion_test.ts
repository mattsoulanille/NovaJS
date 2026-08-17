import 'jasmine';
import {
    MAX_SECONDARY_EXPLOSIONS, MIN_SECONDARY_EXPLOSIONS,
    secondaryExplosionsDue, secondaryExplosionTotal,
} from './ship_explosion.js';

describe('secondary explosion cadence', () => {
    it('accelerates: every gap is shorter than the one before', () => {
        const total = 20;
        // Sample the schedule finely and record when each explosion is
        // due; the intervals must shrink monotonically.
        const times: number[] = [];
        let seen = 0;
        for (let i = 0; i <= 100000; i++) {
            const progress = i / 100000;
            const due = secondaryExplosionsDue(progress, total);
            while (seen < due) {
                times.push(progress);
                seen++;
            }
        }
        expect(times.length).toEqual(total);
        const gaps = times.slice(1).map((t, i) => t - times[i]);
        for (let i = 1; i < gaps.length; i++) {
            expect(gaps[i]).toBeLessThan(gaps[i - 1]);
        }
        // And it is a real speed-up, not a rounding artifact.
        expect(gaps[0]).toBeGreaterThan(gaps[gaps.length - 1] * 5);
    });

    it('starts immediately and finishes exactly at the final explosion',
        () => {
            expect(secondaryExplosionsDue(0, 20)).toEqual(0);
            // The first explosion goes off as soon as the sequence does,
            // rather than after the longest gap.
            expect(secondaryExplosionsDue(1e-6, 20)).toEqual(1);
            expect(secondaryExplosionsDue(1, 20)).toEqual(20);
            expect(secondaryExplosionsDue(5, 20)).toEqual(20);
            // Monotone, and never over the total.
            let previous = 0;
            for (let i = 0; i <= 1000; i++) {
                const due = secondaryExplosionsDue(i / 1000, 20);
                expect(due).toBeGreaterThanOrEqual(previous);
                expect(due).toBeLessThanOrEqual(20);
                previous = due;
            }
        });

    it('gives longer breakups more explosions, within bounds', () => {
        // A Viper disintegrates for 10 frames, a Leviathan for 250.
        expect(secondaryExplosionTotal(10 / 30 * 1000))
            .toEqual(MIN_SECONDARY_EXPLOSIONS);
        expect(secondaryExplosionTotal(250 / 30 * 1000))
            .toBeGreaterThan(MIN_SECONDARY_EXPLOSIONS);
        expect(secondaryExplosionTotal(1e9))
            .toEqual(MAX_SECONDARY_EXPLOSIONS);
        expect(secondaryExplosionTotal(0)).toEqual(MIN_SECONDARY_EXPLOSIONS);
    });
});
