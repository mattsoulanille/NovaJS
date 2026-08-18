import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import {
    escortDailyFee, escortPayrollFee, escortSellValue, escortUpgradeCost,
    escortUpgradeShip, hirePrice,
} from './escort_fees.js';
import { hirePrice as hirePriceFromBar } from './hire_escort.js';

/**
 * ============================================================================
 * What an escort costs and what it is worth
 * ============================================================================
 *
 * escort_fees.ts owns FOUR numbers, and the point of these specs is that
 * each is exactly one rule, applied on the escort's CURRENT ship class:
 *
 *   hirePrice         10% of the (modified) ship price      [the bar]
 *   escortDailyFee    10% of the hire fee                   [Matthew's rule]
 *   escortUpgradeCost shïp EscUpgrdCost, or 0 with no target
 *   escortSellValue   shïp EscSellValue, defaulting to 10% of the cost
 *
 * The Bible gives the last two verbatim; the first two are not in it and are
 * pinned by the original's own captures. See escort_fees.ts's module comment
 * for the ONE reference figure the daily wage disagrees with
 * (hail_escort.png's 1,100 cr/day Terrapin against this rule's 1,500) — that
 * disagreement is pinned below too, deliberately, so it cannot be "fixed" by
 * accident.
 */

function makeShip(ship: Partial<ShipData>): ShipData {
    return { ...getDefaultShipData(), ...ship };
}

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

describe('hirePrice', () => {
    it('charges 10% of the ship price', () => {
        // bar/hire_escort/select_escort.png: a 2,000 cr Cargo Drone is
        // offered at "Hiring Price: 200 cr"; a 300,000 cr Thunderhead
        // hires for 30,000.
        expect(hirePrice(makeShip({ price: 2_000 }))).toBe(200);
        expect(hirePrice(makeShip({ price: 300_000 }))).toBe(30_000);
    });

    it('takes the ränk PriceMod on the ship price first', () => {
        // A discount rank makes hiring the pilot cheaper too, and the
        // Spica Shipyard's compounded 1e-6% makes it free.
        expect(hirePrice(makeShip({ price: 300_000 }), 50)).toBe(15_000);
        expect(hirePrice(makeShip({ price: 12_000_000 }), 1e-6)).toBe(0);
    });

    it('is ONE definition — the bar re-exports this module\'s', () => {
        // hire_escort.ts used to own it; it now re-exports, so the wage,
        // the upgrade cost and the resale value cannot drift from what the
        // player was charged at the bar.
        expect(hirePriceFromBar).toBe(hirePrice);
    });
});

describe('escortDailyFee: the KNOWN divergence from the original', () => {
    it('pays 1,500 cr/day for a Terrapin where the capture shows 1,100',
        () => {
            // hail/hail_escort.png: a hired Terrapin (shïp nova:136, cost
            // 150,000) reads "Pay: 1,100 credits per day". Matthew's rule
            // gives 1,500. One sample is not enough to reverse-engineer the
            // original's formula (1,100 is 0.733% of the hull price and
            // matches no obvious function of its cost, crew, strength or
            // mass), so the specified shape is what ships — and this spec is
            // here so that changing it is a decision rather than an accident.
            expect(escortDailyFee(makeShip({ price: 150_000 }))).toBe(1_500);
        });
});

describe('escortUpgradeShip / escortUpgradeCost', () => {
    it('offers no upgrade when the class has no UpgradeTo', () => {
        // The parser normalizes both of the Bible's sentinels (0 and -1)
        // to null, so there is one thing to test.
        const ship = makeShip({
            escortUpgradeShip: null, escortUpgradeCost: 50_000,
        });
        expect(escortUpgradeShip(ship)).toBeNull();
        // ...and no price, even though the field carries one.
        expect(escortUpgradeCost(ship)).toBe(0);
    });

    it('charges shïp EscUpgrdCost when there is a target class', () => {
        const ship = makeShip({
            escortUpgradeShip: 'nova:137', escortUpgradeCost: 50_000,
        });
        expect(escortUpgradeShip(ship)).toBe('nova:137');
        expect(escortUpgradeCost(ship)).toBe(50_000);
    });

    it('never pays the player to upgrade', () => {
        // A plug-in authoring a negative cost would otherwise hand out
        // credits on a path that only ever checks "can you afford it".
        expect(escortUpgradeCost(makeShip({
            escortUpgradeShip: 'nova:137', escortUpgradeCost: -5_000,
        }))).toBe(0);
    });
});

describe('escortSellValue', () => {
    it('pays the class\'s own EscSellValue when it is positive', () => {
        expect(escortSellValue(makeShip({
            price: 110_000, escortSellValue: 25_000,
        }))).toBe(25_000);
    });

    it('defaults to 10% of the ship\'s cost when EscSellValue <= 0', () => {
        // EVN Bible shïp EscSellValue: "If you input a number that's less
        // than or equal to zero here, Nova will default to 10% of the
        // ship's original cost."
        expect(escortSellValue(makeShip({
            price: 110_000, escortSellValue: 0,
        }))).toBe(11_000);
        expect(escortSellValue(makeShip({
            price: 110_000, escortSellValue: -1,
        }))).toBe(11_000);
    });

    it('floors the default and never goes negative', () => {
        // A hull the player got for nothing must not sell for a credit.
        expect(escortSellValue(makeShip({ price: 5, escortSellValue: 0 })))
            .toBe(0);
        expect(escortSellValue(makeShip({ price: 0, escortSellValue: 0 })))
            .toBe(0);
        expect(escortSellValue(makeShip({ price: 1_005, escortSellValue: 0 })))
            .toBe(100);
    });
});
