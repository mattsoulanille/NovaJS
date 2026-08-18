import 'jasmine';
import { getDefaultRankData, RankData } from 'novadatainterface/rank_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { dailyBudget, settleDailyBudget } from './daily_budget.js';

/**
 * The player's daily books — the one computation behind BOTH the
 * player-info dialog's "Income:" / "Expenses:" lines and the credits a date
 * advance settles (mission_session.ts's advanceEntityDate).
 */
describe('the daily budget', () => {
    function rank(id: string, salary: number, salaryCap = 0): RankData {
        return { ...getDefaultRankData(), id, salary, salaryCap };
    }
    function ship(id: string, price: number): ShipData {
        return { ...getDefaultShipData(), id, price };
    }

    const RANKS = new Map([
        ['nova:128', rank('nova:128', 500)],
        ['nova:129', rank('nova:129', 250)],
        // Extra Outfits' ränk 167, verbatim from the plug-in: a NEGATIVE
        // salary, no affiliated government, and its name says what it is.
        ['extra-outfits:167', rank('extra-outfits:167', -1000)],
        ['capped', rank('capped', 400, 10_000)],
    ]);
    const SHIPS = new Map([
        ['nova:307', ship('nova:307', 320_000)], // Thunderhead: 3,200/day
        ['nova:335', ship('nova:335', 110_000)], // Viper: 1,100/day
    ]);
    const lookups = {
        getRank: (id: string) => RANKS.get(id),
        getShip: (id: string) => SHIPS.get(id),
    };

    it('is empty for a pilot with no ranks and no escorts', () => {
        expect(dailyBudget({ ...lookups }, 1_000))
            .toEqual({ income: 0, expenses: 0 });
    });

    it('adds up the positive ränk salaries as income', () => {
        expect(dailyBudget({
            ...lookups, ranks: ['nova:128', 'nova:129'],
        }, 1_000)).toEqual({ income: 750, expenses: 0 });
    });

    it('counts a NEGATIVE ränk salary as an expense, not as negative '
        + 'income', () => {
            // extra-outfits:167 is named "Shipyard Expenses (1000 per day)"
            // and carries Salary -1000: a plug-in charging upkeep through
            // the only lever the resource has. The two sides stay separate
            // so the dialog can print one line for each.
            expect(dailyBudget({
                ...lookups, ranks: ['nova:128', 'extra-outfits:167'],
            }, 1_000)).toEqual({ income: 500, expenses: 1000 });
        });

    it('charges each escort on the payroll its own daily wage', () => {
        expect(dailyBudget({
            ...lookups, escortShips: ['nova:307', 'nova:335'],
        }, 1_000)).toEqual({ income: 0, expenses: 4_300 });
    });

    it('puts escort wages and negative salaries in the same Expenses '
        + 'figure', () => {
            expect(dailyBudget({
                ...lookups, ranks: ['extra-outfits:167'],
                escortShips: ['nova:307'],
            }, 1_000)).toEqual({ income: 0, expenses: 4_200 });
        });

    it('drops a salary once the player is above its SalaryCap', () => {
        expect(dailyBudget({ ...lookups, ranks: ['capped'] }, 9_999).income)
            .toBe(400);
        expect(dailyBudget({ ...lookups, ranks: ['capped'] }, 10_000).income)
            .toBe(0);
    });

    describe('settling several days', () => {
        it('pays and charges once per day', () => {
            expect(settleDailyBudget({
                ...lookups, ranks: ['nova:128'], escortShips: ['nova:335'],
            }, 100_000, 3)).toBe(100_000 + 3 * (500 - 1_100));
        });

        it('re-tests SalaryCap every morning, so pay stops on the day the '
            + 'cap is crossed', () => {
                // 9,800 -> 10,200 on day one; day two is already over the
                // 10,000 cap and pays nothing.
                expect(settleDailyBudget({ ...lookups, ranks: ['capped'] },
                    9_800, 5)).toBe(10_200);
            });

        it('never drives the balance below zero', () => {
            // A pilot who cannot pay keeps their escorts for now — we have
            // no dismissal flow — but their credits stop at 0 rather than
            // going negative.
            expect(settleDailyBudget({
                ...lookups, escortShips: ['nova:307'],
            }, 5_000, 10)).toBe(0);
        });

        it('leaves the balance alone when the books are empty', () => {
            expect(settleDailyBudget({ ...lookups }, 12_345, 400))
                .toBe(12_345);
        });
    });
});
