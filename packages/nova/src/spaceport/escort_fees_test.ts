import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { escortDailyFee, escortPayrollFee, hirePrice } from './escort_fees.js';

/**
 * What an escort costs to take on and what it costs to keep.
 *
 * Matthew's ruling on the daily wage: "pay per day is 10% of escort's hire
 * price". Our hire price is 10% of the hull's price (hire_escort.ts, matched
 * to a 300,000 cr Thunderhead hiring for 30,000 cr), so the wage lands at 1%
 * of the hull a day — a 320,000 cr Thunderhead hires for 32,000 and then
 * draws 3,200 a day. Both halves live in escort_fees.ts precisely so that the
 * "Expenses:" line the player reads and the credits a date advance takes are
 * the same arithmetic.
 */
describe('escort fees', () => {
    function ship(price: number, id = 'nova:307'): ShipData {
        return { ...getDefaultShipData(), id, price };
    }

    it('charges a day\'s wage of 10% of the hire price', () => {
        const thunderhead = ship(320_000);
        expect(hirePrice(thunderhead)).toBe(32_000);
        expect(escortDailyFee(thunderhead)).toBe(3_200);
        expect(escortDailyFee(thunderhead))
            .toBe(Math.round(hirePrice(thunderhead) / 10));
    });

    it('is 1% of the hull price, rounded, at every scale', () => {
        expect(escortDailyFee(ship(9_995))).toBe(100); // a used Heavy Shuttle
        expect(escortDailyFee(ship(12_000_000))).toBe(120_000); // a Leviathan
        expect(escortDailyFee(ship(0))).toBe(0);
    });

    it('does NOT bend the wage by a stellar\'s ränk PriceMod, though the '
        + 'hire fee is bent', () => {
            // A discount is a thing a particular government's shops do; a
            // wage is drawn wherever the flock happens to be, including deep
            // space where no stellar's rules apply. Hiring at Spica's 1%
            // shipyard is cheap, but the pilot still eats.
            const leviathan = ship(12_000_000);
            expect(hirePrice(leviathan, 1)).toBe(12_000);
            expect(escortDailyFee(leviathan)).toBe(120_000);
            // The parameter is there for a caller genuinely quoting a shop
            // price, and then it does apply.
            expect(escortDailyFee(leviathan, 1)).toBe(1_200);
        });

    it('sums the payroll and skips a hull the data set cannot produce', () => {
        const ships = new Map([
            ['nova:307', ship(320_000, 'nova:307')],
            ['nova:335', ship(110_000, 'nova:335')],
        ]);
        expect(escortPayrollFee(['nova:307', 'nova:335'],
            id => ships.get(id))).toBe(3_200 + 1_100);
        // Two of the same class each draw their own wage.
        expect(escortPayrollFee(['nova:307', 'nova:307'],
            id => ships.get(id))).toBe(6_400);
        // Better to undercharge than to invent a fee for an unknown hull.
        expect(escortPayrollFee(['nova:307', 'nova:999'],
            id => ships.get(id))).toBe(3_200);
        expect(escortPayrollFee([], id => ships.get(id))).toBe(0);
    });
});
