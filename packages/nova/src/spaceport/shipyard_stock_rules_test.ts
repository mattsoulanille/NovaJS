import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import {
    buyRandomDayRoll,
    canBuyShip,
    compareShipIds,
    playerContribute,
    shipAvailabilityPasses,
    shipAvailableForSale,
    shipBuyRandomPasses,
    shipHireable,
    shipRequirementsMet,
    shipStockGatesPass,
    hireRandomDayRoll,
    ShipyardContext,
    visibleShips,
} from './shipyard_stock_rules.js';

function makeShip(id: string, ship: Partial<ShipData> = {}): ShipData {
    // Ships default to "for sale every day" (buyRandom 100) unless a test
    // overrides it, so the tech/availability/require specs aren't tripped by
    // the data default (buyRandom 0 = never available).
    return { ...getDefaultShipData(), id, buyRandom: 100, ...ship };
}

function makeContext(ship: ShipData,
    ctx: Partial<ShipyardContext> = {}): ShipyardContext {
    void ship;
    return {
        bits: new Set(),
        contribute: 0n,
        day: 0,
        stellarId: 1,
        ...ctx,
    };
}

const STELLAR_TECH_5 = { techLevel: 5, specialTech: [] };

describe('shipStocked / tech level', () => {
    it('stocks ships at or below the stellar tech level', () => {
        const stellar = { techLevel: 5, specialTech: [88] };
        const viper = makeShip('nova:128', { techLevel: 4 });
        const leviathan = makeShip('nova:131', { techLevel: 88 });
        // techLevel 88 is a SpecialTech of this stellar — a low-tech
        // world that also carries one absurdly high-tech ship (the Bible's
        // own example). The Leviathan appears only there.
        expect(canBuyShip(viper, makeContext(viper, {
            planet: stellar })).allowed).toBeTrue();
        expect(canBuyShip(leviathan, makeContext(leviathan, {
            planet: stellar })).allowed).toBeTrue();
    });

    it('refuses ships beyond the stellar tech level', () => {
        const beyond = makeShip('nova:999', { techLevel: 999 });
        const check = canBuyShip(beyond, makeContext(beyond, {
            planet: STELLAR_TECH_5 }));
        expect(check.allowed).toBeFalse();
        expect(check.allowed ? '' : check.reason).toBe('notStocked');
    });

    it('stocks everything with no planet context', () => {
        const exotic = makeShip('nova:999', { techLevel: 9999 });
        expect(canBuyShip(exotic, makeContext(exotic)).allowed).toBeTrue();
    });
});

describe('shipAvailabilityPasses', () => {
    it('passes a blank Availability', () => {
        const ship = makeShip('nova:128', { availability: '' });
        expect(shipAvailabilityPasses(ship, makeContext(ship))).toBeTrue();
    });

    it('reads control bits from the context', () => {
        const ship = makeShip('nova:128', { availability: 'b3 & P30' });
        expect(shipAvailabilityPasses(ship, makeContext(ship, {
            bits: new Set([3]) }))).toBeTrue();
        expect(shipAvailabilityPasses(ship, makeContext(ship)))
            .toBeFalse();
        // P30 (registered) defaults true in the NCB evaluator.
    });
});

describe('shipRequirementsMet', () => {
    it('passes an empty Require', () => {
        expect(shipRequirementsMet('0x0', 0n)).toBeTrue();
    });

    it('ANDs Require against the Contribute set', () => {
        const require = '0x30'; // bits 4,5
        expect(shipRequirementsMet(require, 0x10n | 0x20n)).toBeTrue();
        expect(shipRequirementsMet(require, 0x20n)).toBeFalse();
    });

    it('unions the ship and outfit Contribute sets', () => {
        // The player flies a hull contributing bit 4 and carries an outfit
        // contributing bit 5; together they meet Require bits 4,5.
        const contribute = playerContribute('0x10',
            new Map([['nova:200', '0x20']]));
        expect(shipRequirementsMet('0x30', contribute)).toBeTrue();
        expect(shipRequirementsMet('0x80', contribute)).toBeFalse();
    });
});

describe('shipBuyRandomPasses', () => {
    it('always passes buyRandom 100', () => {
        const ship = makeShip('nova:128', { buyRandom: 100 });
        expect(shipBuyRandomPasses(ship, makeContext(ship)))
            .toBeTrue();
    });

    it('never passes buyRandom 0', () => {
        const ship = makeShip('nova:128', { buyRandom: 0 });
        expect(shipBuyRandomPasses(ship, makeContext(ship)))
            .toBeFalse();
    });

    it('always passes a partial BuyRandom while the day roll is off', () => {
        // The day roll is currently disabled (BUY_RANDOM_DAY_ROLL_ENABLED
        // is false; Matthew 2026-08-14): any nonzero BuyRandom is for sale
        // every day. Re-enabling the roll should fail this spec so the
        // flip is a deliberate, test-visible change.
        const ship = makeShip('nova:131', { buyRandom: 45 });
        for (const day of [0, 1, 100, 4321]) {
            expect(shipBuyRandomPasses(ship, makeContext(ship, {
                day, stellarId: 472 }))).toBeTrue();
        }
    });

    // The roll mechanism itself stays under test while the switch is off,
    // via the exported buyRandomDayRoll.
    it('day roll is deterministic: same inputs, same result', () => {
        const ship = makeShip('nova:131', { buyRandom: 45 });
        const a = buyRandomDayRoll(ship, makeContext(ship, {
            day: 200, stellarId: 472 }));
        // Recompute; the hash is pure, so it must agree.
        const b = buyRandomDayRoll(ship, makeContext(ship, {
            day: 200, stellarId: 472 }));
        expect(a).toBe(b);
    });

    it('day roll varies by day for a partial BuyRandom', () => {
        // A 45% ship spread over many days must not roll under 45 every day.
        const ship = makeShip('nova:131', { buyRandom: 45 });
        const daysOpen: number[] = [];
        for (let day = 0; day < 500; day++) {
            if (buyRandomDayRoll(ship, makeContext(ship, {
                day, stellarId: 472 })) < 45) {
                daysOpen.push(day);
            }
        }
        // It should be open on a reasonable minority of days (say 5-80%):
        // an assertion that would catch a "always open" or "always closed"
        // regression while leaving the exact FNV schedule free.
        expect(daysOpen.length).toBeGreaterThan(500 * 0.05);
        expect(daysOpen.length).toBeLessThan(500 * 0.8);
    });

    it('day roll is independent of which player visits', () => {
        // The daily roll is a property of ship+shipyard+day, not the
        // player: two contexts that differ only in control bits agree.
        const ship = makeShip('nova:131', { buyRandom: 45 });
        const plain = buyRandomDayRoll(ship, makeContext(ship, {
            day: 100, stellarId: 472 }));
        const rich = buyRandomDayRoll(ship, makeContext(ship, {
            day: 100, stellarId: 472,
            bits: new Set([1, 2, 3, 4, 5]) }));
        expect(plain).toBe(rich);
    });

    it('never uses Math.random or Date.now', () => {
        // Spy to prove the module is deterministic.
        spyOn(Math, 'random').and.callThrough();
        spyOn(Date, 'now').and.callThrough();
        const ship = makeShip('nova:131', { buyRandom: 45 });
        for (let day = 0; day < 30; day++) {
            shipBuyRandomPasses(ship, makeContext(ship, {
                day, stellarId: 472 }));
            buyRandomDayRoll(ship, makeContext(ship, {
                day, stellarId: 472 }));
        }
        expect(Math.random).not.toHaveBeenCalled();
        expect(Date.now).not.toHaveBeenCalled();
    });
});

describe('canBuyShip', () => {
    it('refuses when Availability is false', () => {
        const ship = makeShip('nova:131', { availability: 'b9' });
        const check = canBuyShip(ship, makeContext(ship, {
            planet: STELLAR_TECH_5 }));
        expect(check.allowed).toBeFalse();
        expect(check.allowed ? '' : check.reason).toBe('availability');
    });

    it('refuses a never-sold (BuyRandom 0) ship even with the day roll off',
        () => {
            const ship = makeShip('nova:131', { buyRandom: 0 });
            const check = canBuyShip(ship, makeContext(ship, {
                planet: STELLAR_TECH_5 }));
            expect(check.allowed).toBeFalse();
            expect(check.allowed ? '' : check.reason)
                .toBe('notAvailableToday');
            // Permanent "never sold", not a bad day: no "today".
            expect(check.allowed ? '' : check.message)
                .toBe('This ship isn\'t for sale.');
        });

    it('refuses when Require is unmet', () => {
        const ship = makeShip('nova:131', { require: '0x10' });
        const check = canBuyShip(ship, makeContext(ship, {
            planet: STELLAR_TECH_5, contribute: 0n }));
        expect(check.allowed).toBeFalse();
        expect(check.allowed ? '' : check.reason).toBe('require');
    });

    it('allows a fully-qualified ship', () => {
        const ship = makeShip('nova:128', {
            techLevel: 4, buyRandom: 100, availability: 'b3',
        });
        const ctx = makeContext(ship, {
            planet: STELLAR_TECH_5, bits: new Set([3]) });
        expect(canBuyShip(ship, ctx).allowed).toBeTrue();
    });
});

describe('Flags3 0x4000 equal-DispWeight exclusion', () => {
    it('hides higher-numbered ships of equal DispWeight when the excluder '
        + 'is available for sale', () => {
        // Ship A (lower id) shares DispWeight with ship B (higher id), and
        // A carries 0x4000. When A is for sale, B must be excluded.
        const a = makeShip('nova:130', {
            displayWeight: 100,
            excludeEqualDisplayWeight: true,
            buyRandom: 100, techLevel: 3 });
        const b = makeShip('nova:131', {
            displayWeight: 100, techLevel: 3, buyRandom: 100 });
        const c = makeShip('nova:132', {
            displayWeight: 99, techLevel: 3, buyRandom: 100 });
        const ctx = makeContext(a, { planet: STELLAR_TECH_5 });
        const list = visibleShips([c, b, a], ctx).map(s => s.id);
        expect(list).toContain('nova:130');
        // B is hidden (equal DispWeight, higher id, excluder for sale).
        expect(list).not.toContain('nova:131');
        // C has a different DispWeight, so it is not affected.
        expect(list).toContain('nova:132');
    });

    it('does not hide anything when the excluder is NOT for sale today',
        () => {
            const a = makeShip('nova:130', {
                displayWeight: 100,
                excludeEqualDisplayWeight: true,
                buyRandom: 0, techLevel: 3 });
            const b = makeShip('nova:131', {
                displayWeight: 100, techLevel: 3, buyRandom: 100 });
            const ctx = makeContext(a, {
                planet: STELLAR_TECH_5 });
            const list = visibleShips([b, a], ctx).map(s => s.id);
            expect(list).toContain('nova:131');
        });
});

describe('visibleShips', () => {
    it('hides a ship that is never for sale (BuyRandom 0) instead of '
        + 'showing it greyed', () => {
        // Matthew, 2026-08-15: hide ships that aren't for sale — the
        // Vell-os craft and mission-only hulls stop cluttering the grid.
        const never = makeShip('nova:173', { buyRandom: 0, techLevel: 1 });
        const sold = makeShip('nova:128', { buyRandom: 100, techLevel: 1 });
        const ctx = makeContext(sold, { planet: STELLAR_TECH_5 });
        expect(visibleShips([never, sold], ctx).map(s => s.id))
            .toEqual(['nova:128']);
    });

    it('sorts by DispWeight descending, ties by id ascending', () => {
        const low = makeShip('nova:128', { displayWeight: 5 });
        const high = makeShip('nova:129', { displayWeight: 10 });
        const sameHigh = makeShip('nova:130', { displayWeight: 10 });
        const list = visibleShips(
            [low, sameHigh, high],
            makeContext(low, { planet: STELLAR_TECH_5 }))
            .map(s => s.id);
        expect(list).toEqual(['nova:129', 'nova:130', 'nova:128']);
    });

    it('hides when Flags3 0x0100 is set and Availability is false', () => {
        const ship = makeShip('nova:131', {
            availability: 'b9',
            hideIfAvailabilityFalse: true });
        const list = visibleShips([ship], makeContext(ship, {
            planet: STELLAR_TECH_5 }));
        expect(list.map(s => s.id)).not.toContain('nova:131');
    });

    it('shows greyed when Availability is false without 0x0100', () => {
        const ship = makeShip('nova:141', {
            availability: 'b78', techLevel: 14 });
        const list = visibleShips([ship], makeContext(ship, {
            planet: { techLevel: 20, specialTech: [] } }));
        // Still listed (greyed, purchase refused).
        expect(list.map(s => s.id)).toContain('nova:141');
    });

    it('hides when Flags3 0x0200 is set and Require is unmet', () => {
        const ship = makeShip('nova:131', {
            require: '0x10', hideIfRequireUnmet: true });
        const list = visibleShips([ship], makeContext(ship, {
            planet: STELLAR_TECH_5, contribute: 0n }));
        expect(list.map(s => s.id)).not.toContain('nova:131');
    });

    it('shows greyed when Require is unmet without 0x0200', () => {
        const ship = makeShip('nova:131', { require: '0x10' });
        const list = visibleShips([ship], makeContext(ship, {
            planet: STELLAR_TECH_5, contribute: 0n }));
        expect(list.map(s => s.id)).toContain('nova:131');
    });
});

describe('compareShipIds', () => {
    it('orders by numeric resource id across prefixes', () => {
        expect(compareShipIds('nova:128', 'nova:129')).toBeLessThan(0);
        expect(compareShipIds('nova:129', 'nova:128')).toBeGreaterThan(0);
        // Non-numeric ids sort last.
        expect(compareShipIds('mod:abc', 'nova:1')).toBeGreaterThan(0);
    });
});

describe('shipAvailableForSale', () => {
    it('requires tech, availability, require and the day roll', () => {
        const ship = makeShip('nova:128', {
            techLevel: 4, availability: 'b3', require: '0x10',
            buyRandom: 100 });
        const ctx = makeContext(ship, {
            planet: STELLAR_TECH_5, bits: new Set([3]),
            contribute: 0x10n });
        expect(shipAvailableForSale(ship, ctx)).toBeTrue();
        // Withhold the require bit -> not for sale.
        const unmet = makeContext(ship, {
            planet: STELLAR_TECH_5, bits: new Set([3]),
            contribute: 0n });
        expect(shipAvailableForSale(ship, unmet)).toBeFalse();
    });
});

/**
 * The BAR's hire pool (Matthew, 2026-08-18: "I can't hire TAM drones (or
 * any escorts) at Tektaara Station"). Hiring is a bar function (EVN Bible,
 * shïp HireRandom: "available for hire in the bar on a given day"), and it
 * gates on the SAME shïp stock rules the shipyard uses — the bar used to
 * test only `techLevel <= planet.techLevel`, which is empty at every
 * SpecialTech-only stellar.
 */
describe('shipHireable', () => {
    const TEKTAARA = { techLevel: -1, specialTech: [10000] };

    it('hires ships at or below the stellar tech level', () => {
        const ship = makeShip('nova:167', {
            techLevel: 4, hireRandom: 95, price: 80_000,
        });
        expect(shipHireable(ship, makeContext(ship, {
            planet: STELLAR_TECH_5 }))).toBeTrue();
    });

    it('hires a ship whose TechLevel is an exact SpecialTech match', () => {
        // Extra Outfits' Anti-Missile Drone at Tektaara Station: the
        // stellar's own TechLevel is -1, so ONLY the exact SpecialTech
        // match can put this pilot in the bar.
        const drone = makeShip('extra-outfits:800', {
            techLevel: 10000, hireRandom: 100, price: 500_000,
        });
        expect(shipHireable(drone, makeContext(drone, { planet: TEKTAARA })))
            .toBeTrue();
    });

    it('refuses a ship the stellar does not stock', () => {
        // techLevel 10003 is a SpecialTech of Spica Shipyard, NOT of
        // Tektaara — near misses must not slip through.
        const other = makeShip('extra-outfits:806', {
            techLevel: 10003, hireRandom: 100, price: 300_000,
        });
        expect(shipHireable(other, makeContext(other, { planet: TEKTAARA })))
            .toBeFalse();
        const beyond = makeShip('nova:999', {
            techLevel: 999, hireRandom: 100, price: 1000,
        });
        expect(shipHireable(beyond, makeContext(beyond, {
            planet: STELLAR_TECH_5 }))).toBeFalse();
    });

    it('honours the Availability control-bit expression', () => {
        const rebel = makeShip('nova:177', {
            techLevel: 5, hireRandom: 100, price: 120_000,
            availability: 'b130',
        });
        expect(shipHireable(rebel, makeContext(rebel, {
            planet: STELLAR_TECH_5 }))).toBeFalse();
        expect(shipHireable(rebel, makeContext(rebel, {
            planet: STELLAR_TECH_5, bits: new Set([130]) }))).toBeTrue();
    });

    it('honours the Require bits against the player Contribute', () => {
        const frigate = makeShip('nova:140', {
            techLevel: 5, hireRandom: 100, price: 750_000,
            require: '0x300000000',
        });
        expect(shipHireable(frigate, makeContext(frigate, {
            planet: STELLAR_TECH_5 }))).toBeFalse();
        expect(shipHireable(frigate, makeContext(frigate, {
            planet: STELLAR_TECH_5, contribute: 0x300000000n }))).toBeTrue();
    });

    it('never hires a HireRandom 0 ship, however cheap or low-tech', () => {
        // "A HireRandom of 0 means this ship will never be made available
        // for hire." Extra Outfits' Offensive Drone is exactly this: a
        // tech-10000 ship Tektaara stocks but no pilot ever flies.
        const offensive = makeShip('extra-outfits:816', {
            techLevel: 10000, hireRandom: 0, price: 1_000_000,
        });
        expect(shipHireable(offensive, makeContext(offensive, {
            planet: TEKTAARA }))).toBeFalse();
    });

    it('does not require BuyRandom: a never-sold ship can be hired', () => {
        // The Anti-Missile Drone (and stock Nova's second-hand hulls,
        // nova:361-372) have BuyRandom 0 and a nonzero HireRandom.
        const drone = makeShip('extra-outfits:800', {
            techLevel: 10000, hireRandom: 100, price: 500_000, buyRandom: 0,
        });
        const ctx = makeContext(drone, { planet: TEKTAARA });
        expect(shipAvailableForSale(drone, ctx)).toBeFalse();
        expect(shipHireable(drone, ctx)).toBeTrue();
    });

    it('needs a price: the hire fee is a percentage of it', () => {
        const free = makeShip('nova:895', {
            techLevel: 0, hireRandom: 100, price: 0,
        });
        expect(shipHireable(free, makeContext(free, {
            planet: STELLAR_TECH_5 }))).toBeFalse();
    });

    it('rolls HireRandom per day, deterministically', () => {
        const ship = makeShip('nova:141', {
            techLevel: 5, hireRandom: 20, price: 2_000_000,
        });
        const at = (day: number) => makeContext(ship, {
            planet: STELLAR_TECH_5, day, stellarId: 472 });
        // Pure: the same day gives the same answer, so closing and
        // reopening the bar cannot reroll the pool.
        expect(hireRandomDayRoll(ship, at(200)))
            .toBe(hireRandomDayRoll(ship, at(200)));
        expect(shipHireable(ship, at(200)))
            .toBe(shipHireable(ship, at(200)));
        // And it actually varies: a 20% ship is neither always nor never
        // in the pool over a long stretch of days.
        let open = 0;
        for (let day = 0; day < 500; day++) {
            if (shipHireable(ship, at(day))) {
                open++;
            }
        }
        expect(open).toBeGreaterThan(0);
        expect(open).toBeLessThan(500);
    });

    it('rolls hire and buy independently for the same ship/day', () => {
        // Different salts: a ship must not be "in the bar exactly on the
        // days it is in the shipyard".
        const ship = makeShip('nova:141', { hireRandom: 50, buyRandom: 50 });
        let differ = 0;
        for (let day = 0; day < 200; day++) {
            const ctx = makeContext(ship, {
                planet: STELLAR_TECH_5, day, stellarId: 472 });
            if (hireRandomDayRoll(ship, ctx) !== buyRandomDayRoll(ship, ctx)) {
                differ++;
            }
        }
        expect(differ).toBeGreaterThan(150);
    });

    it('never uses Math.random or Date.now', () => {
        const random = spyOn(Math, 'random').and.callThrough();
        const now = spyOn(Date, 'now').and.callThrough();
        const ship = makeShip('nova:141', {
            techLevel: 5, hireRandom: 20, price: 2_000_000,
        });
        shipHireable(ship, makeContext(ship, {
            planet: STELLAR_TECH_5, day: 7, stellarId: 472 }));
        expect(random).not.toHaveBeenCalled();
        expect(now).not.toHaveBeenCalled();
    });
});

/** The gate the shipyard and the bar literally share. */
describe('shipStockGatesPass', () => {
    it('is the sale gate minus the daily roll', () => {
        const ship = makeShip('nova:167', { techLevel: 4, buyRandom: 0 });
        const ctx = makeContext(ship, { planet: STELLAR_TECH_5 });
        expect(shipStockGatesPass(ship, ctx)).toBeTrue();
        expect(shipAvailableForSale(ship, ctx)).toBeFalse();
    });

    it('fails on tech, Availability or Require', () => {
        const ctxOf = (ship: ShipData, over: Partial<ShipyardContext> = {}) =>
            makeContext(ship, { planet: STELLAR_TECH_5, ...over });
        const tooHigh = makeShip('nova:999', { techLevel: 999 });
        expect(shipStockGatesPass(tooHigh, ctxOf(tooHigh))).toBeFalse();
        const gated = makeShip('nova:177', {
            techLevel: 4, availability: 'b130',
        });
        expect(shipStockGatesPass(gated, ctxOf(gated))).toBeFalse();
        expect(shipStockGatesPass(gated,
            ctxOf(gated, { bits: new Set([130]) }))).toBeTrue();
        const needs = makeShip('nova:140', {
            techLevel: 4, require: '0x300000000',
        });
        expect(shipStockGatesPass(needs, ctxOf(needs))).toBeFalse();
        expect(shipStockGatesPass(needs,
            ctxOf(needs, { contribute: 0x300000000n }))).toBeTrue();
    });
});
