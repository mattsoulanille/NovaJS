import { autoRefuelPurchase, refuelCost } from './spaceport.js';

describe('refuelCost', function() {
    it('charges 100 credits per missing jump of fuel', function() {
        expect(refuelCost({ current: 0, max: 600 })).toEqual(600);
        expect(refuelCost({ current: 300, max: 600 })).toEqual(300);
        expect(refuelCost({ current: 500, max: 600 })).toEqual(100);
    });

    it('prorates partial jumps, rounding up', function() {
        expect(refuelCost({ current: 550, max: 600 })).toEqual(50);
        expect(refuelCost({ current: 599.5, max: 600 })).toEqual(1);
    });

    it('costs nothing when full', function() {
        expect(refuelCost({ current: 600, max: 600 })).toEqual(0);
    });
});

/**
 * The auto-refueller short of credits (reference "The Auto-recharger short
 * of credits (E7 leftover), wave 40"): the Kit Jump Lancer, Fuel 300 and
 * empty, landed with 100 credits and left with 100 units and 0 credits.
 */
describe('autoRefuelPurchase', function() {
    it('buys what the credits pay for when the fill is out of reach',
        function() {
            expect(autoRefuelPurchase({ current: 0, max: 300 }, 100))
                .toEqual({ units: 100, cost: 100 });
            expect(autoRefuelPurchase({ current: 50, max: 300 }, 137))
                .toEqual({ units: 137, cost: 137 });
        });

    it('buys the full fill when it is affordable', function() {
        expect(autoRefuelPurchase({ current: 0, max: 300 }, 1000))
            .toEqual({ units: 300, cost: 300 });
        expect(autoRefuelPurchase({ current: 0, max: 300 }, 300))
            .toEqual({ units: 300, cost: 300 });
        expect(autoRefuelPurchase({ current: 599.5, max: 600 }, 1))
            .toEqual({ units: 0.5, cost: 1 });
    });

    it('buys nothing with no credits or a full tank', function() {
        expect(autoRefuelPurchase({ current: 0, max: 300 }, 0))
            .toEqual({ units: 0, cost: 0 });
        expect(autoRefuelPurchase({ current: 300, max: 300 }, 500))
            .toEqual({ units: 0, cost: 0 });
    });
});
