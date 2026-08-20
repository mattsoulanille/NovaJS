import 'jasmine';
import {
    BUY_RANDOM_DAY_ROLL_ENABLED, dayRoll, passesDayRoll, resourceNumber,
} from './day_roll.js';

/**
 * The shared per-day shop roll (oütf BuyRandom, shïp BuyRandom/HireRandom).
 * The master switch is off, so `passesDayRoll` says "offered" for anything
 * with a nonzero percentage; the roll itself is exercised directly, the way
 * shipyard_stock_rules_test does, so the mechanism stays pinned until the
 * switch flips.
 */
describe('day roll', () => {
    const at = (day: number, stellarId: number | null = 128) =>
        ({ day, stellarId });

    it('is deterministic for the same shop, item, stellar and day', () => {
        expect(dayRoll('outfit', 506, at(430000)))
            .toBe(dayRoll('outfit', 506, at(430000)));
        expect(dayRoll('buy', 128, at(1))).toBe(dayRoll('buy', 128, at(1)));
    });

    it('stays inside 0-99', () => {
        for (let day = 0; day < 500; day++) {
            const roll = dayRoll('outfit', 506, at(day));
            expect(roll).toBeGreaterThanOrEqual(0);
            expect(roll).toBeLessThan(100);
        }
    });

    it('varies across days, stellars and items', () => {
        const days = new Set<number>();
        for (let day = 0; day < 200; day++) {
            days.add(dayRoll('outfit', 506, at(day)));
        }
        expect(days.size).toBeGreaterThan(50);
        expect(new Set([128, 129, 130, 131, 132].map(
            stellar => dayRoll('outfit', 506, at(430000, stellar)))).size)
            .toBeGreaterThan(1);
        expect(new Set([504, 505, 506].map(
            item => dayRoll('outfit', item, at(430000)))).size)
            .toBeGreaterThan(1);
    });

    it('salts the three shops apart so they draw independently', () => {
        // Over a run of days, an outfit, a hull and a hireable pilot with
        // the same resource number must not share one coin flip.
        let differed = 0;
        for (let day = 0; day < 100; day++) {
            const buy = dayRoll('buy', 300, at(day));
            const hire = dayRoll('hire', 300, at(day));
            const outfit = dayRoll('outfit', 300, at(day));
            if (buy !== hire && hire !== outfit && buy !== outfit) {
                differed++;
            }
        }
        expect(differed).toBeGreaterThan(90);
    });

    it('treats a missing day and a missing stellar as usable inputs', () => {
        expect(dayRoll('outfit', 506, {})).toBe(dayRoll('outfit', 506, {}));
        expect(dayRoll('outfit', 506, { day: 5 }))
            .toBe(dayRoll('outfit', 506, { day: 5, stellarId: null }));
    });

    describe('passesDayRoll', () => {
        it('refuses a zero percentage whatever the switch says', () => {
            expect(passesDayRoll(0, 'outfit', 506, at(430000))).toBe(false);
            expect(passesDayRoll(-1, 'outfit', 506, at(430000))).toBe(false);
        });

        it('always offers 100 or more ("greater than 100 ... as 100")', () => {
            expect(passesDayRoll(100, 'outfit', 506, at(430000))).toBe(true);
            expect(passesDayRoll(255, 'outfit', 506, at(430000))).toBe(true);
        });

        it('offers every nonzero percentage while the switch is off', () => {
            expect(BUY_RANDOM_DAY_ROLL_ENABLED).toBe(false);
            for (let day = 0; day < 200; day++) {
                expect(passesDayRoll(1, 'outfit', 506, at(day))).toBe(true);
                expect(passesDayRoll(15, 'buy', 128, at(day))).toBe(true);
            }
        });

        it('makes no roll at all without a day', () => {
            expect(passesDayRoll(1, 'outfit', 506, {})).toBe(true);
            expect(passesDayRoll(1, 'outfit', 506, { stellarId: 128 }))
                .toBe(true);
        });
    });

    describe('resourceNumber', () => {
        it('reads the number out of a global id', () => {
            expect(resourceNumber('nova:128')).toBe(128);
            expect(resourceNumber('extra-outfits:506')).toBe(506);
            expect(resourceNumber('More Blasters CHEAT:520')).toBe(520);
            expect(resourceNumber('471')).toBe(471);
        });

        it('is null when there is no number', () => {
            expect(resourceNumber('nova:builtin')).toBeNull();
            expect(resourceNumber('')).toBeNull();
        });
    });
});
