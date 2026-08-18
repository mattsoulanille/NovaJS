import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import {
    escortDailyFee, escortDailyFeeForPrice, escortSellValue,
    escortUpgradeCost, escortUpgradeShip, hirePrice, hirePriceForPrice,
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
 * The Bible gives the last two verbatim; the first two are not in it and
 * are pinned by the original's own captures. See the module comment for
 * the ONE reference figure the daily wage disagrees with (hail_escort.png's
 * 1,100 cr/day Terrapin against this rule's 1,500) — that disagreement is
 * pinned below too, deliberately, so it cannot be "fixed" by accident.
 */

function makeShip(ship: Partial<ShipData>): ShipData {
    return { ...getDefaultShipData(), ...ship };
}

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
        // hire_escort.ts used to own it; it now re-exports, so the wage
        // below cannot drift from what the player was charged at the bar.
        expect(hirePriceFromBar).toBe(hirePrice);
    });

    it('has a bare-price form that agrees with the ShipData form', () => {
        for (const price of [0, 1, 2_000, 17_500, 150_000, 300_000]) {
            expect(hirePriceForPrice(price))
                .toBe(hirePrice(makeShip({ price })));
        }
    });
});

describe('escortDailyFee', () => {
    it('pays 10% of the hire fee per day (1% of the ship price)', () => {
        // Matthew's rule, and the only shape specified: the wage is a
        // fixed fraction of what the pilot was hired for.
        expect(escortDailyFee(makeShip({ price: 300_000 }))).toBe(3_000);
        expect(escortDailyFee(makeShip({ price: 2_000 }))).toBe(20);
        expect(escortDailyFee(makeShip({ price: 0 }))).toBe(0);
    });

    it('is exactly ESCORT_DAILY_FRACTION of hirePrice for any hull', () => {
        for (const price of [0, 999, 17_500, 150_000, 12_000_000]) {
            const ship = makeShip({ price });
            expect(escortDailyFee(ship))
                .toBe(Math.round(hirePrice(ship) * 0.10));
        }
    });

    it('DIVERGES from the reference capture, knowingly', () => {
        // hail/hail_escort.png: a hired Terrapin (shïp nova:136, cost
        // 150,000) reads "Pay: 1,100 credits per day". Matthew's rule
        // gives 1,500. One sample is not enough to reverse-engineer the
        // original's formula (1,100 is 0.733% of the hull price and
        // matches no obvious function of its cost, crew, strength or
        // mass), so the specified shape is what ships — and this spec is
        // here so that changing it is a decision rather than an accident.
        expect(escortDailyFee(makeShip({ price: 150_000 }))).toBe(1_500);
    });

    it('has a bare-price form for the daily expenses readout', () => {
        // The Income/Expenses panel sums a fleet from each escort's class
        // price; it must charge exactly what the comm dialog quotes.
        for (const price of [0, 2_000, 150_000, 300_000]) {
            expect(escortDailyFeeForPrice(price))
                .toBe(escortDailyFee(makeShip({ price })));
        }
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
