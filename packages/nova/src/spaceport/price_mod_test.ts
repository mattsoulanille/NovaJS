import 'jasmine';
import { OutfitData, getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { ShipData, getDefaultShipData } from 'novadatainterface/ship_data';
import { hirePrice } from './hire_escort.js';
import {
    modifiedPrice, UNMODIFIED_PRICE_MOD,
} from './price_mod.js';
import {
    outfitPrice, outfitResaleValue, sellRefund,
} from './outfitter_rules.js';
import {
    ShipPurchaseContext, shipListPrice, shipPurchasePrice, tradeInValue,
} from './shipyard_rules.js';

/**
 * The ränk PriceMod as the shops see it: one price function (price_mod.ts's
 * modifiedPrice) behind the shipyard's ship price and the bar's hire fee —
 * and NOT behind the outfitter, per Matthew's ruling that at Extra Outfits'
 * Spica Shipyard "while ships should be free, building materials and outfits
 * should NOT be". price_mod.ts writes up the plug-in data that settles it.
 */

function ship(price: number, id = 'nova:200'): ShipData {
    return { ...getDefaultShipData(), id, price };
}

function outfit(price: number, id = 'nova:300'): OutfitData {
    return { ...getDefaultOutfitData(), id, price };
}

/** A purchase context flying a worthless hull, so the trade-in is 0. */
function purchaseContext(priceMod?: number): ShipPurchaseContext {
    return {
        currentShip: ship(0, 'nova:199'),
        outfits: new Map(),
        getOutfit: () => undefined,
        credits: 100_000_000,
        priceMod,
    };
}

describe('modifiedPrice', () => {
    it('leaves the list price alone at 100 (and with no modifier)', () => {
        expect(UNMODIFIED_PRICE_MOD).toBe(100);
        expect(modifiedPrice(12_345)).toBe(12_345);
        expect(modifiedPrice(12_345, 100)).toBe(12_345);
    });

    it('halves at 50 and doubles at 200', () => {
        expect(modifiedPrice(12_345, 50)).toBe(6_172); // floored
        expect(modifiedPrice(12_345, 200)).toBe(24_690);
    });

    it('floors to whole credits and never goes negative', () => {
        expect(modifiedPrice(99, 50)).toBe(49);
        expect(modifiedPrice(1, 50)).toBe(0);
        expect(modifiedPrice(0, 50)).toBe(0);
    });

    it('is free once the modifier is small enough to floor to zero', () => {
        // Extra Outfits' four compounding PriceMod-1 Spica ranks.
        const spica = 1e-6;
        expect(modifiedPrice(12_000_000, spica)).toBe(0);
        expect(modifiedPrice(2_000, spica)).toBe(0);
    });
});

describe('the shipyard ship price', () => {
    it('scales the asking price by the PriceMod', () => {
        const target = ship(200_000);
        expect(shipListPrice(target, purchaseContext())).toBe(200_000);
        expect(shipListPrice(target, purchaseContext(50))).toBe(100_000);
        expect(shipListPrice(target, purchaseContext(1e-6))).toBe(0);
    });

    it('charges the modified asking price, and the Buy path and the '
        + 'displayed price are the same function', () => {
            const target = ship(200_000);
            const ctx = purchaseContext(50);
            expect(shipPurchasePrice(target, ctx))
                .toBe(shipListPrice(target, ctx));
            expect(shipPurchasePrice(target, purchaseContext(1e-6))).toBe(0);
        });

    it('does NOT scale the trade-in valuation (judgment call 9)', () => {
        const ctx: ShipPurchaseContext = {
            ...purchaseContext(50),
            currentShip: ship(400_000, 'nova:199'),
        };
        // 25% of the ORIGINAL cost, not of the discounted one.
        expect(tradeInValue(ctx)).toBe(100_000);
        // ... and the trade-in never pays out cash, only offsets.
        expect(shipPurchasePrice(ship(100_000), ctx)).toBe(0);
    });
});

describe('the outfitter item price', () => {
    it('is the oütf Cost as written, with NO PriceMod applied', () => {
        const item = outfit(5_000);
        expect(outfitPrice(item)).toBe(5_000);
        // outfitPrice takes no MODIFIER at all: the only thing a caller can
        // pass besides the outfit is the HULL it goes on, which exists for
        // the oütf 0x0200 ship-mass-proportional rule (a property of the
        // item, not a discount) and leaves an unflagged item's price
        // alone. There is still no argument that bends a price. That is
        // the ruling expressed in the type, not just in the arithmetic.
        expect(outfitPrice.length).toBe(2);
        expect(outfitResaleValue.length).toBe(2);
        expect(sellRefund.length).toBe(3);
        const heavyHull = { ...getDefaultShipData() };
        heavyHull.physics = { ...heavyHull.physics, mass: 10_000 };
        expect(outfitPrice(item, heavyHull)).toBe(5_000);
    });

    it('is unaffected by the ranks that make Spica\'s SHIPS free', () => {
        // Same modifier, same session: the hull goes to zero, the item in
        // the shop next door does not budge. A 7,000,000 cr "Building
        // Materials °10000 tons°" package is exactly the case Matthew ruled
        // on — free materials would break the plug-in's economy loop.
        const spica = 1e-6;
        expect(shipListPrice(ship(12_000_000), purchaseContext(spica)))
            .toBe(0);
        expect(outfitPrice(outfit(7_000_000))).toBe(7_000_000);
        expect(outfitPrice(outfit(2_500))).toBe(2_500);
        expect(outfitPrice(outfit(2_250_000))).toBe(2_250_000);
    });

    it('keeps buy and sell-back symmetric, so a round trip never profits',
        () => {
            // Both ends quote the same unmodified Cost, which is what makes
            // the no-minting invariant hold by construction rather than by
            // two modifiers happening to agree.
            for (const price of [0, 1, 99, 5_000, 7_000_000]) {
                const item = outfit(price);
                expect(outfitResaleValue(item))
                    .toBeLessThanOrEqual(outfitPrice(item));
            }
            expect(outfitResaleValue(outfit(5_000))).toBe(2_500);
            expect(outfitResaleValue(outfit(4_001))).toBe(2_000); // floored
        });

    it('refunds a same-visit purchase at exactly what was paid', () => {
        const item = outfit(5_000);
        expect(sellRefund(item, 1).credited).toBe(outfitPrice(item));
        expect(sellRefund(item, 0).credited).toBe(outfitResaleValue(item));
    });
});

describe('the bar hire fee', () => {
    it('is 10% of the MODIFIED ship price', () => {
        const thunderhead = ship(300_000);
        expect(hirePrice(thunderhead)).toBe(30_000);
        expect(hirePrice(thunderhead, 100)).toBe(30_000);
        expect(hirePrice(thunderhead, 50)).toBe(15_000);
    });

    it('is zero when the modified price is zero', () => {
        // Every hull Extra Outfits' Spica Shipyard builds, at the four
        // compounded PriceMod-1 ranks: the player already paid to construct
        // them.
        for (const price of [2_000, 10_000, 350_000, 12_000_000]) {
            expect(hirePrice(ship(price), 1e-6)).toBe(0);
        }
    });
});
