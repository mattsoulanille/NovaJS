import 'jasmine';
import { formatCredits } from '../display/status_bar_content.js';
import { formatPrice } from './format_price.js';

describe('formatPrice', () => {
    it('comma-groups amounts under a million', () => {
        expect(formatPrice(0)).toBe('0 cr');
        expect(formatPrice(45_000)).toBe('45,000 cr');
        expect(formatPrice(999_999)).toBe('999,999 cr');
    });

    it('prints millions with three truncated decimals', () => {
        expect(formatPrice(1_000_000)).toBe('1.000M cr');
        expect(formatPrice(1_500_000)).toBe('1.500M cr');
        expect(formatPrice(1_925_999)).toBe('1.925M cr');
        expect(formatPrice(21_844_979)).toBe('21.844M cr');
        expect(formatPrice(1_234_567_890)).toBe('1,234.567M cr');
    });

    it('keeps the leading zeros of the fraction (the 1.925M-for-1.09M bug)', () => {
        // Matthew's 2026-11-27 playtest: 1,092,5xx credits read
        // "You Have: 1.925M cr" in the outfitter while the status bar said
        // 1.09M and a 1.5M item was (correctly) unaffordable.
        expect(formatPrice(1_092_513)).toBe('1.092M cr');
        expect(formatPrice(1_047_413)).toBe('1.047M cr');
        expect(formatPrice(2_050_000)).toBe('2.050M cr');
        expect(formatPrice(1_000_001)).toBe('1.000M cr');
        expect(formatPrice(1_009_999)).toBe('1.009M cr');
    });

    it('never shows more than the balance, and agrees with the status bar', () => {
        for (const credits of [1_092_513, 1_499_999, 1_999_999, 3_004_000,
            12_345_678]) {
            const pane = Number(formatPrice(credits).replace(/[^0-9.]/g, ''));
            const bar = Number(formatCredits(credits).replace(/[^0-9.]/g, ''));
            expect(pane * 1e6).toBeLessThanOrEqual(credits);
            expect(bar * 1e6).toBeLessThanOrEqual(credits);
            // The bar is the pane cut to two decimals.
            expect(Math.floor(pane * 100 + 1e-9) / 100).toBeCloseTo(bar, 6);
        }
    });
});
