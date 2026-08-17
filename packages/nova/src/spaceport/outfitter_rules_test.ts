import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultProjectileWeaponData, WeaponData } from 'novadatainterface/weapon_data';
import {
    ammoCapacity,
    BULK_BUY_LIMIT,
    canBuyOutfit,
    canSellOutfit,
    effectiveMax,
    freeCargo,
    freeMass,
    maxBuyCount,
    maxSellCount,
    NEGATIVE_FREE_MASS_REFUSAL,
    OUTFIT_RESALE_FRACTION,
    outfitResaleValue,
    OutfitterContext,
    playerContribute,
    sellRefund,
} from './outfitter_rules.js';

function makeShip(physics: Partial<ShipData['physics']> = {},
    rest: Partial<ShipData> = {}): ShipData {
    const ship = { ...getDefaultShipData(), ...rest };
    ship.physics = { ...ship.physics, freeMass: 100, ...physics };
    return ship;
}

function makeOutfit(id: string, outfit: Partial<OutfitData> = {},
    physics: Partial<OutfitData['physics']> = {}): OutfitData {
    return {
        ...getDefaultOutfitData(),
        id,
        ...outfit,
        physics: { freeMass: 0, ...physics },
    };
}

function makeWeapon(id: string, weapon: Partial<WeaponData> = {}): WeaponData {
    return { ...getDefaultProjectileWeaponData(), id, ...weapon } as WeaponData;
}

function makeContext({ ship, outfits, weapons, owned, bits, credits,
    deployed }: {
        ship?: ShipData,
        outfits?: OutfitData[],
        weapons?: WeaponData[],
        owned?: [string, number][],
        bits?: number[],
        credits?: number,
        /** Owned but not aboard — bay fighters still in flight. */
        deployed?: [string, number][],
    } = {}): OutfitterContext {
    const outfitMap = new Map((outfits ?? []).map(o => [o.id, o]));
    const weaponMap = new Map((weapons ?? []).map(w => [w.id, w]));
    return {
        shipData: ship ?? makeShip(),
        outfits: new Map(owned ?? []),
        getOutfit: id => outfitMap.get(id),
        getWeapon: id => weaponMap.get(id),
        bits: new Set(bits ?? []),
        // Default to effectively unlimited so tests that don't care about
        // money aren't gated by it (stock default outfit price is 0).
        credits: credits ?? Infinity,
        ...(deployed ? { deployedCounts: new Map(deployed) } : {}),
    };
}

describe('freeMass', () => {
    it('subtracts the mass of owned outfits', () => {
        const heavy = makeOutfit('nova:200', {}, { freeMass: 10 });
        const context = makeContext({
            outfits: [heavy],
            owned: [['nova:200', 2]],
        });
        expect(freeMass(context)).toBe(80);
    });
});

describe('freeCargo', () => {
    it('applies outfit cargo modifications', () => {
        const expander = makeOutfit('nova:200', {}, { freeCargo: 15 });
        const context = makeContext({
            ship: makeShip({ freeCargo: 10 }),
            outfits: [expander],
            owned: [['nova:200', 1]],
        });
        expect(freeCargo(context)).toBe(25);
    });
});

describe('playerContribute', () => {
    it('unions the ship and outfit contribute sets', () => {
        const context = makeContext({
            ship: makeShip({}, { contribute: '0x1' }),
            outfits: [makeOutfit('nova:200', { contribute: '0x100000000' })],
            owned: [['nova:200', 1]],
        });
        expect(playerContribute(context)).toBe(0x100000001n);
    });
});

describe('canBuyOutfit', () => {
    it('allows a plain affordable outfit', () => {
        const outfit = makeOutfit('nova:200', {}, { freeMass: 10 });
        expect(canBuyOutfit(outfit, makeContext()))
            .toEqual({ allowed: true });
    });

    it('requires enough free mass', () => {
        const outfit = makeOutfit('nova:200', {}, { freeMass: 30 });
        const context = makeContext({
            ship: makeShip({ freeMass: 50 }),
            outfits: [outfit],
            owned: [['nova:200', 1]],
        });
        // 20 tons left; another 30-ton outfit doesn't fit.
        expect(canBuyOutfit(outfit, context)).toEqual(jasmine.objectContaining(
            { allowed: false, reason: 'mass' }));
    });

    it('requires a free gun hardpoint for fixed guns', () => {
        const gun = makeOutfit('nova:200', { fixedGun: true });
        const full = makeContext({
            ship: makeShip({ maxGuns: 2 }),
            outfits: [gun],
            owned: [['nova:200', 2]],
        });
        expect(canBuyOutfit(gun, full)).toEqual(jasmine.objectContaining(
            { allowed: false, reason: 'gunHardpoints' }));

        const oneFree = makeContext({
            ship: makeShip({ maxGuns: 2 }),
            outfits: [gun],
            owned: [['nova:200', 1]],
        });
        expect(canBuyOutfit(gun, oneFree)).toEqual({ allowed: true });
    });

    it('requires a free turret hardpoint for turrets', () => {
        const turret = makeOutfit('nova:200', { turret: true });
        const context = makeContext({
            ship: makeShip({ maxTurrets: 1 }),
            outfits: [turret],
            owned: [['nova:200', 1]],
        });
        expect(canBuyOutfit(turret, context)).toEqual(jasmine.objectContaining(
            { allowed: false, reason: 'turretHardpoints' }));
    });

    it('counts outfit-granted hardpoints', () => {
        const gun = makeOutfit('nova:200', { fixedGun: true });
        const rack = makeOutfit('nova:201', {}, { maxGuns: 1 });
        const context = makeContext({
            ship: makeShip({ maxGuns: 1 }),
            outfits: [gun, rack],
            owned: [['nova:200', 1], ['nova:201', 1]],
        });
        expect(canBuyOutfit(gun, context)).toEqual({ allowed: true });
    });

    it('enforces the max count', () => {
        const outfit = makeOutfit('nova:200', { max: 2 });
        const context = makeContext({
            outfits: [outfit],
            owned: [['nova:200', 2]],
        });
        expect(canBuyOutfit(outfit, context)).toEqual(jasmine.objectContaining(
            { allowed: false, reason: 'maxCount' }));
    });

    it('treats max 0 as unlimited', () => {
        const outfit = makeOutfit('nova:200', { max: 0 });
        const context = makeContext({
            outfits: [outfit],
            owned: [['nova:200', 500]],
        });
        expect(canBuyOutfit(outfit, context)).toEqual({ allowed: true });
    });

    it('multiplies max by owned increase-maximum items', () => {
        const outfit = makeOutfit('nova:200', { max: 2 });
        const booster = makeOutfit('nova:201', { increasesMax: 'nova:200' });
        const context = makeContext({
            outfits: [outfit, booster],
            owned: [['nova:200', 2], ['nova:201', 2]],
        });
        expect(effectiveMax(outfit, context)).toBe(4);
        expect(canBuyOutfit(outfit, context)).toEqual({ allowed: true });
    });

    it('enforces the availability control bit test', () => {
        const outfit = makeOutfit('nova:200', { availability: 'b13 & !b14' });
        expect(canBuyOutfit(outfit, makeContext({ bits: [13] })))
            .toEqual({ allowed: true });
        expect(canBuyOutfit(outfit, makeContext({ bits: [] })))
            .toEqual(jasmine.objectContaining(
                { allowed: false, reason: 'availability' }));
        expect(canBuyOutfit(outfit, makeContext({ bits: [13, 14] })))
            .toEqual(jasmine.objectContaining(
                { allowed: false, reason: 'availability' }));
    });

    it('lets availability check owned outfits with Oxxx', () => {
        const licensed = makeOutfit('nova:200', { availability: 'o300' });
        const license = makeOutfit('nova:300');
        expect(canBuyOutfit(licensed, makeContext({
            outfits: [license],
            owned: [['nova:300', 1]],
        }))).toEqual({ allowed: true });
        expect(canBuyOutfit(licensed, makeContext())).toEqual(
            jasmine.objectContaining(
                { allowed: false, reason: 'availability' }));
    });

    it('resolves an Oxxx term in the outfit\'s own plug-in first', () => {
        // The Extra Outfits shape: two grades of the same item, each
        // excluding the other. Both live in the plug-in's id space, and
        // the stock data has no outfit 301 at all.
        const goodGrade = makeOutfit('plug:300', { availability: '!o301' });
        const badGrade = makeOutfit('plug:301');
        expect(canBuyOutfit(goodGrade, makeContext({
            outfits: [goodGrade, badGrade],
            owned: [['plug:301', 1]],
        }))).toEqual(jasmine.objectContaining(
            { allowed: false, reason: 'availability' }));
        expect(canBuyOutfit(goodGrade, makeContext({
            outfits: [goodGrade, badGrade],
        }))).toEqual({ allowed: true });
    });

    it('falls back to the stock id space when the plug-in has no such id',
        () => {
            // A plug-in outfit referring to a STOCK licence it does not
            // redefine: nothing named "plug:300" exists, so O300 is nova:300.
            const licensed = makeOutfit('plug:200', { availability: 'o300' });
            const license = makeOutfit('nova:300');
            expect(canBuyOutfit(licensed, makeContext({
                outfits: [licensed, license],
                owned: [['nova:300', 1]],
            }))).toEqual({ allowed: true });
        });

    it('counts a deployed fighter as owned for Oxxx', () => {
        // Bible: "The Oxxx operator also considers any carried fighters
        // that are deployed when it examines the player's current list of
        // outfits." A launched fighter is gone from context.outfits.
        const gated = makeOutfit('nova:200', { availability: 'o300' });
        const fighter = makeOutfit('nova:300');
        expect(canBuyOutfit(gated, makeContext({
            outfits: [gated, fighter],
            deployed: [['nova:300', 1]],
        }))).toEqual({ allowed: true });
    });

    it('treats a malformed availability expression as available', () => {
        const outfit = makeOutfit('nova:200', { availability: 'b13 &' });
        expect(canBuyOutfit(outfit, makeContext()))
            .toEqual({ allowed: true });
    });

    it('requires the player contribute bits to cover the require bits', () => {
        const outfit = makeOutfit('nova:200', { require: '0x3' });
        const partial = makeContext({
            ship: makeShip({}, { contribute: '0x1' }),
        });
        expect(canBuyOutfit(outfit, partial)).toEqual(jasmine.objectContaining(
            { allowed: false, reason: 'require' }));

        const covering = makeContext({
            ship: makeShip({}, { contribute: '0x1' }),
            outfits: [makeOutfit('nova:201', { contribute: '0x2' })],
            owned: [['nova:201', 1]],
        });
        expect(canBuyOutfit(outfit, covering)).toEqual({ allowed: true });
    });

    describe('launcher-restricted ammunition', () => {
        // A launcher weapon that draws 15 rounds per instance from its
        // own supply, the outfit that grants it, and its ammo outfit.
        const launcherWeapon = makeWeapon('nova:134', {
            ammoType: ['weapon', 'nova:134'],
            maxAmmo: 15,
        });
        const launcher = makeOutfit('nova:133', {
            weapons: { 'nova:134': 1 },
        });
        const ammo = makeOutfit('nova:135', {
            max: 200,
            ammoFor: 'nova:134',
        });

        it('denies ammo without a launcher', () => {
            const context = makeContext({
                outfits: [launcher, ammo],
                weapons: [launcherWeapon],
            });
            expect(ammoCapacity(ammo, context)).toBe(0);
            expect(canBuyOutfit(ammo, context)).toEqual(
                jasmine.objectContaining(
                    { allowed: false, reason: 'needsLauncher' }));
        });

        it('caps ammo at maxAmmo per owned launcher', () => {
            const oneLauncher = makeContext({
                outfits: [launcher, ammo],
                weapons: [launcherWeapon],
                owned: [['nova:133', 1], ['nova:135', 14]],
            });
            expect(ammoCapacity(ammo, oneLauncher)).toBe(15);
            expect(canBuyOutfit(ammo, oneLauncher))
                .toEqual({ allowed: true });

            const full = makeContext({
                outfits: [launcher, ammo],
                weapons: [launcherWeapon],
                owned: [['nova:133', 1], ['nova:135', 15]],
            });
            expect(canBuyOutfit(ammo, full)).toEqual(
                jasmine.objectContaining(
                    { allowed: false, reason: 'needsLauncher' }));

            const twoLaunchers = makeContext({
                outfits: [launcher, ammo],
                weapons: [launcherWeapon],
                owned: [['nova:133', 2], ['nova:135', 15]],
            });
            expect(ammoCapacity(ammo, twoLaunchers)).toBe(30);
            expect(canBuyOutfit(ammo, twoLaunchers))
                .toEqual({ allowed: true });
        });

        describe('deployed bay fighters', () => {
            // A bay holding 4 fighters, the outfit granting it, and the
            // fighter outfit that is its ammo. This is exactly how a
            // stock Viper Bay parses now: the bay's ammoType points at
            // itself and its MaxAmmo is the fighters one bay holds.
            const bayWeapon = makeWeapon('nova:149', {
                ammoType: ['weapon', 'nova:149'],
                maxAmmo: 4,
            });
            const bayOutfit = makeOutfit('nova:157', {
                name: 'Viper Bay',
                weapons: { 'nova:149': 1 },
            });
            const fighter = makeOutfit('nova:158', {
                name: 'Viper',
                max: 9999,
                ammoFor: 'nova:149',
            });

            it('counts fighters in flight against the bay\'s capacity, '
                + 'so landing with them out cannot buy past the cap', () => {
                    // 4 aboard = full, obviously denied.
                    const aboard = makeContext({
                        outfits: [bayOutfit, fighter],
                        weapons: [bayWeapon],
                        owned: [['nova:157', 1], ['nova:158', 4]],
                    });
                    expect(canBuyOutfit(fighter, aboard)).toEqual(
                        jasmine.objectContaining(
                            { allowed: false, reason: 'needsLauncher' }));

                    // All 4 LAUNCHED: consumeAmmo has already emptied
                    // the magazine, so without deployed accounting the
                    // outfitter would happily sell 4 more.
                    const allDeployed = makeContext({
                        outfits: [bayOutfit, fighter],
                        weapons: [bayWeapon],
                        owned: [['nova:157', 1], ['nova:158', 0]],
                        deployed: [['nova:158', 4]],
                    });
                    expect(canBuyOutfit(fighter, allDeployed)).toEqual(
                        jasmine.objectContaining(
                            { allowed: false, reason: 'needsLauncher' }));
                    expect(maxBuyCount(fighter, allDeployed)).toBe(0);
                });

            it('mixes deployed and aboard fighters against one capacity',
                () => {
                    // 1 aboard + 2 flying = 3 of 4; room for exactly 1.
                    const mixed = makeContext({
                        outfits: [bayOutfit, fighter],
                        weapons: [bayWeapon],
                        owned: [['nova:157', 1], ['nova:158', 1]],
                        deployed: [['nova:158', 2]],
                    });
                    expect(ammoCapacity(fighter, mixed)).toBe(4);
                    expect(canBuyOutfit(fighter, mixed))
                        .toEqual({ allowed: true });
                    expect(maxBuyCount(fighter, mixed)).toBe(1);
                });

            it('still allows buying up to the capacity that is left',
                () => {
                    // 2 flying, none aboard: 2 of 4 used.
                    const context = makeContext({
                        outfits: [bayOutfit, fighter],
                        weapons: [bayWeapon],
                        owned: [['nova:157', 1], ['nova:158', 0]],
                        deployed: [['nova:158', 2]],
                    });
                    expect(maxBuyCount(fighter, context)).toBe(2);
                });

            it('counts deployed units against the outfit\'s Max too',
                () => {
                    // Max 2, no launcher restriction (MaxAmmo 0), one
                    // unit flying: only one more may be bought.
                    const freeBay = makeWeapon('nova:149', {
                        ammoType: ['weapon', 'nova:149'],
                        maxAmmo: 0,
                    });
                    const capped = makeOutfit('nova:158', {
                        max: 2,
                        ammoFor: 'nova:149',
                    });
                    const context = makeContext({
                        outfits: [bayOutfit, capped],
                        weapons: [freeBay],
                        owned: [['nova:157', 1]],
                        deployed: [['nova:158', 1]],
                    });
                    expect(effectiveMax(capped, context)).toBe(2);
                    expect(maxBuyCount(capped, context)).toBe(1);

                    const atMax = makeContext({
                        outfits: [bayOutfit, capped],
                        weapons: [freeBay],
                        owned: [['nova:157', 1]],
                        deployed: [['nova:158', 2]],
                    });
                    expect(canBuyOutfit(capped, atMax)).toEqual(
                        jasmine.objectContaining(
                            { allowed: false, reason: 'maxCount' }));
                });

            it('sells only fighters physically aboard', () => {
                // 1 aboard, 3 flying: a fighter in flight is not on the
                // ship to sell.
                const context = makeContext({
                    outfits: [bayOutfit, fighter],
                    weapons: [bayWeapon],
                    owned: [['nova:157', 1], ['nova:158', 1]],
                    deployed: [['nova:158', 3]],
                });
                expect(canSellOutfit(fighter, context))
                    .toEqual({ allowed: true });
                expect(maxSellCount(fighter, context)).toBe(1);

                // All of them out: nothing to sell at all.
                const allOut = makeContext({
                    outfits: [bayOutfit, fighter],
                    weapons: [bayWeapon],
                    owned: [['nova:157', 1], ['nova:158', 0]],
                    deployed: [['nova:158', 4]],
                });
                expect(canSellOutfit(fighter, allOut)).toEqual(
                    jasmine.objectContaining(
                        { allowed: false, reason: 'notOwned' }));
                expect(maxSellCount(fighter, allOut)).toBe(0);
            });

            describe('selling the bay out from under them', () => {
                // Matthew's rule: "I should not be able to buy a bay and
                // fighters, launch the fighters, land, and then sell the
                // bay." The fighters are not in `outfits` at all (launching
                // spent them), so only the bay -> fighter link catches it.
                it('refuses to sell the bay while its fighters are out',
                    () => {
                        const context = makeContext({
                            outfits: [bayOutfit, fighter],
                            weapons: [bayWeapon],
                            owned: [['nova:157', 1], ['nova:158', 0]],
                            deployed: [['nova:158', 4]],
                        });
                        expect(canSellOutfit(bayOutfit, context)).toEqual(
                            jasmine.objectContaining({
                                allowed: false,
                                reason: 'fightersDeployed',
                            }));
                        // The bulk-sell dialog and the greyed Sell button
                        // both read through here, so they agree with the
                        // rule for free.
                        expect(maxSellCount(bayOutfit, context)).toBe(0);
                    });

                it('asks for the fighters once they are home again', () => {
                    // Recalling them changes the refusal, it does not lift
                    // it: four fighters aboard a bay about to be sold have
                    // nowhere to go either. Now they CAN be sold, so this
                    // is the stock sentence rather than "recall them".
                    const returned = makeContext({
                        outfits: [bayOutfit, fighter],
                        weapons: [bayWeapon],
                        owned: [['nova:157', 1], ['nova:158', 4]],
                    });
                    expect(canSellOutfit(bayOutfit, returned)).toEqual({
                        allowed: false,
                        reason: 'ammoAboard',
                        message: 'You need to sell 4 units of ammunition'
                            + ' before you can sell your Viper Bay.',
                    });
                    expect(maxSellCount(bayOutfit, returned)).toBe(0);
                });

                it('sells the bay once the fighters have been sold', () => {
                    const empty = makeContext({
                        outfits: [bayOutfit, fighter],
                        weapons: [bayWeapon],
                        owned: [['nova:157', 1], ['nova:158', 0]],
                    });
                    expect(canSellOutfit(bayOutfit, empty))
                        .toEqual({ allowed: true });
                    expect(maxSellCount(bayOutfit, empty)).toBe(1);
                });

                it('sells the bay once the fighters have been destroyed',
                    () => {
                        // Shot down while the player shopped: the provider
                        // is re-read per refresh, so the count drops to
                        // zero with nothing coming back aboard.
                        const destroyed = makeContext({
                            outfits: [bayOutfit, fighter],
                            weapons: [bayWeapon],
                            owned: [['nova:157', 1], ['nova:158', 0]],
                            deployed: [['nova:158', 0]],
                        });
                        expect(canSellOutfit(bayOutfit, destroyed))
                            .toEqual({ allowed: true });
                    });

                it('still sells the fighter units that ARE aboard', () => {
                    // 1 aboard, 3 flying. The aboard unit is on the ship
                    // and may be handed over; the BAY may not, because
                    // three fighters still need somewhere to dock.
                    const context = makeContext({
                        outfits: [bayOutfit, fighter],
                        weapons: [bayWeapon],
                        owned: [['nova:157', 1], ['nova:158', 1]],
                        deployed: [['nova:158', 3]],
                    });
                    expect(canSellOutfit(fighter, context))
                        .toEqual({ allowed: true });
                    expect(maxSellCount(fighter, context)).toBe(1);
                    expect(canSellOutfit(bayOutfit, context)).toEqual(
                        jasmine.objectContaining({
                            allowed: false, reason: 'fightersDeployed',
                        }));
                });

                it('locks only the bay the deployed fighters belong to',
                    () => {
                        const otherWeapon = makeWeapon('nova:150', {
                            ammoType: ['weapon', 'nova:150'],
                            maxAmmo: 2,
                        });
                        const otherBay = makeOutfit('nova:159', {
                            weapons: { 'nova:150': 1 },
                        });
                        const otherFighter = makeOutfit('nova:160', {
                            max: 9999,
                            ammoFor: 'nova:150',
                        });
                        // TWO of the second bay, so its own two fighters
                        // still fit after one is sold: the point under test
                        // is that the FIRST bay's deployed complement does
                        // not reach across to lock it.
                        const context = makeContext({
                            outfits: [bayOutfit, fighter, otherBay,
                                otherFighter],
                            weapons: [bayWeapon, otherWeapon],
                            owned: [['nova:157', 1], ['nova:158', 0],
                                ['nova:159', 2], ['nova:160', 2]],
                            deployed: [['nova:158', 4]],
                        });
                        expect(canSellOutfit(bayOutfit, context)).toEqual(
                            jasmine.objectContaining({
                                allowed: false,
                                reason: 'fightersDeployed',
                            }));
                        // A second, unrelated bay with its own complement
                        // sitting in it is untouched by the first bay's
                        // fighters being out.
                        expect(canSellOutfit(otherBay, context))
                            .toEqual({ allowed: true });
                        expect(canSellOutfit(otherFighter, context))
                            .toEqual({ allowed: true });
                    });

                it('leaves outfits that grant no bay alone', () => {
                    const cannon = makeOutfit('nova:200', {
                        weapons: { 'nova:120': 1 },
                    });
                    const context = makeContext({
                        outfits: [bayOutfit, fighter, cannon],
                        weapons: [bayWeapon],
                        owned: [['nova:157', 1], ['nova:158', 0],
                            ['nova:200', 1]],
                        deployed: [['nova:158', 4]],
                    });
                    expect(canSellOutfit(cannon, context))
                        .toEqual({ allowed: true });
                });

                it('sells one of two bays when the survivor can take them',
                    () => {
                        // Two units of the SAME bay outfit (capacity 8),
                        // one fighter out: the surviving bay takes it home,
                        // so the sale is fine. This case used to be refused
                        // outright as the conservative choice available
                        // before the launcher sell rule existed.
                        const context = makeContext({
                            outfits: [bayOutfit, fighter],
                            weapons: [bayWeapon],
                            owned: [['nova:157', 2], ['nova:158', 0]],
                            deployed: [['nova:158', 1]],
                        });
                        expect(canSellOutfit(bayOutfit, context))
                            .toEqual({ allowed: true });
                        // But only ONE of them: dropping to zero bays
                        // would strand the fighter.
                        expect(maxSellCount(bayOutfit, context)).toBe(1);
                    });

                it('refuses when the deployed complement alone overflows',
                    () => {
                        // Two bays (8), five fighters all out, none aboard:
                        // one bay holds 4, so the fifth has nowhere to go
                        // and there is nothing aboard to sell instead. The
                        // only move is a recall, so it is that wording and
                        // not the stock ammunition sentence.
                        const context = makeContext({
                            outfits: [bayOutfit, fighter],
                            weapons: [bayWeapon],
                            owned: [['nova:157', 2], ['nova:158', 0]],
                            deployed: [['nova:158', 5]],
                        });
                        expect(canSellOutfit(bayOutfit, context)).toEqual(
                            jasmine.objectContaining({
                                allowed: false,
                                reason: 'fightersDeployed',
                            }));
                    });

                it('asks for the aboard fighters when those can clear it',
                    () => {
                        // Two bays (8), 4 out and 4 aboard. Selling one bay
                        // leaves room for 4: the 4 deployed fit, so the 4
                        // aboard are what has to go, and the count in the
                        // sentence is that shortfall.
                        const context = makeContext({
                            outfits: [bayOutfit, fighter],
                            weapons: [bayWeapon],
                            owned: [['nova:157', 2], ['nova:158', 4]],
                            deployed: [['nova:158', 4]],
                        });
                        expect(canSellOutfit(bayOutfit, context)).toEqual({
                            allowed: false,
                            reason: 'ammoAboard',
                            message: 'You need to sell 4 units of ammunition'
                                + ' before you can sell your Viper Bay.',
                        });
                    });
            });

            it('leaves mass, cargo and hardpoints reading only what is '
                + 'installed', () => {
                    // A deliberate boundary (see deployed_outfits.ts):
                    // a fighter in flight really is off the ship, so its
                    // tonnage is not charged while it is away.
                    const heavy = makeOutfit('nova:158',
                        { max: 9999, ammoFor: 'nova:149' }, { freeMass: 10 });
                    const context = makeContext({
                        outfits: [bayOutfit, heavy],
                        weapons: [bayWeapon],
                        owned: [['nova:157', 1], ['nova:158', 1]],
                        deployed: [['nova:158', 3]],
                    });
                    expect(freeMass(context)).toBe(90);
                });
        });

        it('freely sells ammo whose weapon has no maxAmmo', () => {
            // MaxAmmo <= 0: constrained by the outfit's Max field
            // instead, so no launcher is needed.
            const freeAmmoWeapon = makeWeapon('nova:134', {
                ammoType: ['weapon', 'nova:134'],
                maxAmmo: 0,
            });
            const context = makeContext({
                outfits: [launcher, ammo],
                weapons: [freeAmmoWeapon],
            });
            expect(ammoCapacity(ammo, context)).toBeUndefined();
            expect(canBuyOutfit(ammo, context)).toEqual({ allowed: true });
        });

        /*
         * The capacity comes from the SUPPLY weapon the ammo's ModVal
         * names, per the Bible's MaxAmmo ("per each instance of this
         * weapon", ~:3375) -- not from the weapons that draw on that
         * supply. Every stock launcher is its own supply and points its
         * AmmoType at itself, so only plug-in data tells the two apart.
         */
        describe('capacity comes from the supply weapon', () => {
            it('counts instances of the supply weapon, not of its drawers',
                () => {
                    // The Nuke plug-in's shape: oütf 446 "Nuke Storage
                    // Rack" grants the SUPPLY wëap 238 (MaxAmmo 8), while
                    // oütf 445 "Missile Launcer" grants wëap 236, whose
                    // AmmoType draws on 238 and whose own MaxAmmo is 0.
                    const rackWeapon = makeWeapon('nova:238', { maxAmmo: 8 });
                    const tubeWeapon = makeWeapon('nova:236', {
                        ammoType: ['weapon', 'nova:238'], maxAmmo: 0,
                    });
                    const rack = makeOutfit('nova:446',
                        { max: 15, weapons: { 'nova:238': 1 } });
                    const tube = makeOutfit('nova:445',
                        { max: 6, weapons: { 'nova:236': 1 } });
                    const nuke = makeOutfit('nova:444',
                        { max: 120, ammoFor: 'nova:238' });
                    const outfits = [rack, tube, nuke];
                    const weapons = [rackWeapon, tubeWeapon];

                    // Two racks hold 16 rounds whether or not a tube is
                    // fitted -- racks are the magazine.
                    expect(ammoCapacity(nuke, makeContext({
                        outfits, weapons, owned: [['nova:446', 2]],
                    }))).toBe(16);
                    expect(ammoCapacity(nuke, makeContext({
                        outfits, weapons,
                        owned: [['nova:446', 2], ['nova:445', 1]],
                    }))).toBe(16);

                    // A tube with no rack holds nothing. Reading the
                    // DRAWER's MaxAmmo of 0 instead would have made this
                    // "unlimited" and let the player buy 120 nukes with
                    // nowhere to put them.
                    const tubeOnly = makeContext({
                        outfits, weapons, owned: [['nova:445', 1]],
                    });
                    expect(ammoCapacity(nuke, tubeOnly)).toBe(0);
                    expect(canBuyOutfit(nuke, tubeOnly)).toEqual(
                        jasmine.objectContaining(
                            { allowed: false, reason: 'needsLauncher' }));
                });

            it('holds ammo for a supply weapon that draws energy', () => {
                // The 'singularity' plug-in's shape: oütf 476 "Nuetrino
                // Shard" is ammo for wëap 264, which has MaxAmmo 25 AND an
                // AmmoType of ["energy", n] -- it burns fuel per shot as
                // well as consuming a shard. Nothing draws on its supply,
                // so a walk over drawers found no capacity at all and that
                // ammunition could never be bought.
                const cannonWeapon = makeWeapon('singularity:264', {
                    ammoType: ['energy', 3], maxAmmo: 25,
                });
                const cannon = makeOutfit('singularity:475',
                    { max: 6, weapons: { 'singularity:264': 1 } });
                const shard = makeOutfit('singularity:476',
                    { max: 120, ammoFor: 'singularity:264' });
                const context = makeContext({
                    outfits: [cannon, shard],
                    weapons: [cannonWeapon],
                    owned: [['singularity:475', 2]],
                });
                expect(ammoCapacity(shard, context)).toBe(50);
                expect(canBuyOutfit(shard, context)).toEqual({ allowed: true });
                expect(maxBuyCount(shard, context)).toBe(50);
            });

            it('multiplies by the instances one outfit grants', () => {
                // A twin launcher: one item, two mounts, so twice the
                // magazine ("if you have two of these weapons, the max
                // amount of ammo ... would actually be twice MaxAmmo").
                const twin = makeOutfit('nova:400',
                    { weapons: { 'nova:134': 2 } });
                expect(ammoCapacity(ammo, makeContext({
                    outfits: [twin, ammo],
                    weapons: [launcherWeapon],
                    owned: [['nova:400', 2]],
                }))).toBe(60);
            });
        });
    });

    it('requires enough cargo space for cargo-consuming outfits', () => {
        const scoop = makeOutfit('nova:200', {}, { freeCargo: -10 });
        expect(canBuyOutfit(scoop, makeContext({
            ship: makeShip({ freeCargo: 5 }),
        }))).toEqual(jasmine.objectContaining(
            { allowed: false, reason: 'cargo' }));
        expect(canBuyOutfit(scoop, makeContext({
            ship: makeShip({ freeCargo: 20 }),
        }))).toEqual({ allowed: true });
    });

    it('requires enough credits to afford the item', () => {
        const outfit = makeOutfit('nova:200', { price: 5000 });
        expect(canBuyOutfit(outfit, makeContext({ credits: 4999 })))
            .toEqual(jasmine.objectContaining(
                { allowed: false, reason: 'credits' }));
        // Exactly the price is affordable.
        expect(canBuyOutfit(outfit, makeContext({ credits: 5000 })))
            .toEqual({ allowed: true });
    });

    it('lets a free outfit be bought with zero credits', () => {
        const free = makeOutfit('nova:200', { price: 0 });
        expect(canBuyOutfit(free, makeContext({ credits: 0 })))
            .toEqual({ allowed: true });
    });
});

describe('outfitResaleValue', () => {
    it('is 50% of the outfit price (Matthew\'s rule)', () => {
        expect(OUTFIT_RESALE_FRACTION).toBe(0.5);
        expect(outfitResaleValue(makeOutfit('nova:200', { price: 5000 })))
            .toBe(2500);
    });

    it('floors fractional halves', () => {
        expect(outfitResaleValue(makeOutfit('nova:200', { price: 4001 })))
            .toBe(2000); // 2000.5 floored.
    });
});

describe('sellRefund (same-visit full refund)', () => {
    const outfit = makeOutfit('nova:200', { price: 5000 });

    it('refunds the full price for a unit bought this visit', () => {
        expect(sellRefund(outfit, 1))
            .toEqual({ credited: 5000, boughtThisVisit: 0 });
    });

    it('falls back to the 50% resale for a pre-owned unit', () => {
        expect(sellRefund(outfit, 0))
            .toEqual({ credited: 2500, boughtThisVisit: 0 });
    });

    it('drains same-visit purchases first, then pre-owned (bulk split)', () => {
        // Bought 3 this visit, selling 5: 3 full refunds then 2 at 50%.
        let boughtThisVisit = 3;
        const credited: number[] = [];
        for (let i = 0; i < 5; i++) {
            const refund = sellRefund(outfit, boughtThisVisit);
            credited.push(refund.credited);
            boughtThisVisit = refund.boughtThisVisit;
        }
        expect(credited).toEqual([5000, 5000, 5000, 2500, 2500]);
        expect(boughtThisVisit).toBe(0);
    });

    it('treats a reset visit (count 0) as entirely pre-owned', () => {
        // After the outfitter closes, visitPurchases resets to 0, so a
        // later re-entry sells everything at the 50% resale value.
        expect(sellRefund(outfit, 0).credited).toBe(2500);
    });
});

describe('canSellOutfit', () => {
    it('requires owning the outfit', () => {
        const outfit = makeOutfit('nova:200');
        expect(canSellOutfit(outfit, makeContext())).toEqual(
            jasmine.objectContaining({ allowed: false, reason: 'notOwned' }));
    });

    it('denies selling unsellable outfits', () => {
        const outfit = makeOutfit('nova:200', { cantSell: true });
        const context = makeContext({
            outfits: [outfit],
            owned: [['nova:200', 1]],
        });
        expect(canSellOutfit(outfit, context)).toEqual(
            jasmine.objectContaining({ allowed: false, reason: 'cantSell' }));
    });

    it('allows selling owned sellable outfits', () => {
        const outfit = makeOutfit('nova:200');
        const context = makeContext({
            outfits: [outfit],
            owned: [['nova:200', 1]],
        });
        expect(canSellOutfit(outfit, context)).toEqual({ allowed: true });
    });

    describe('the launcher sell rule', () => {
        // A stock-shaped missile launcher: MaxAmmo 0, so its ammo is
        // constrained by the oütf Max field alone and is freely buyable
        // with no launcher at all (the IR Missile / IR Missile Launcher
        // pair). Selling the launcher out from under the rounds is still
        // refused -- see THE LAUNCHER SELL RULE beside canSellOutfit.
        const missileWeapon = makeWeapon('nova:134', {
            ammoType: ['weapon', 'nova:134'],
            maxAmmo: 0,
        });
        const missileLauncher = makeOutfit('nova:133', {
            name: 'IR Missile Launcher',
            weapons: { 'nova:134': 1 },
        });
        const missile = makeOutfit('nova:135', {
            name: 'IR Missile', max: 200, ammoFor: 'nova:134',
        });
        const missileContext = (owned: [string, number][]) => makeContext({
            outfits: [missileLauncher, missile],
            weapons: [missileWeapon],
            owned,
        });

        it('refuses the last launcher while its magazine is loaded', () => {
            const context = missileContext(
                [['nova:133', 1], ['nova:135', 50]]);
            expect(canSellOutfit(missileLauncher, context)).toEqual({
                allowed: false,
                reason: 'ammoAboard',
                message: 'You need to sell 50 units of ammunition before'
                    + ' you can sell your IR Missile Launcher.',
            });
            // The greyed Sell button and the bulk-sell dialog both read
            // through maxSellCount, so they agree for free.
            expect(maxSellCount(missileLauncher, context)).toBe(0);
        });

        it('uses the singular unit word for one round (STR# 208)', () => {
            const context = missileContext(
                [['nova:133', 1], ['nova:135', 1]]);
            expect(canSellOutfit(missileLauncher, context)).toEqual(
                jasmine.objectContaining({
                    message: 'You need to sell 1 unit of ammunition before'
                        + ' you can sell your IR Missile Launcher.',
                }));
        });

        it('sells the launcher once the magazine is empty', () => {
            expect(canSellOutfit(missileLauncher,
                missileContext([['nova:133', 1], ['nova:135', 0]])))
                .toEqual({ allowed: true });
        });

        it('sells one of two launchers with rounds still aboard', () => {
            // MaxAmmo 0: there is no per-launcher capacity to shrink, so
            // any surviving launcher keeps the rounds mountable. Only the
            // LAST one is refused.
            const context = missileContext(
                [['nova:133', 2], ['nova:135', 50]]);
            expect(canSellOutfit(missileLauncher, context))
                .toEqual({ allowed: true });
            expect(maxSellCount(missileLauncher, context)).toBe(1);
        });

        it('leaves the ammunition itself sellable', () => {
            // Ammo grants no weapon, so it is nobody's launcher. Selling
            // the rounds is exactly how the player clears the refusal.
            const context = missileContext(
                [['nova:133', 1], ['nova:135', 50]]);
            expect(canSellOutfit(missile, context)).toEqual({ allowed: true });
            expect(maxSellCount(missile, context)).toBe(50);
        });

        it('ignores a weapon whose ammunition the player does not own',
            () => {
                expect(canSellOutfit(missileLauncher,
                    missileContext([['nova:133', 1]])))
                    .toEqual({ allowed: true });
            });

        describe('with a per-launcher capacity (MaxAmmo > 0)', () => {
            // A rack-shaped magazine: 8 rounds per instance.
            const rackWeapon = makeWeapon('nova:238', { maxAmmo: 8 });
            const rack = makeOutfit('nova:446', {
                name: 'Nuke Storage Rack', max: 15,
                weapons: { 'nova:238': 1 },
            });
            const nuke = makeOutfit('nova:444', {
                name: 'Nuclear Missile', max: 120, ammoFor: 'nova:238',
            });
            const rackContext = (racks: number, nukes: number) => makeContext({
                outfits: [rack, nuke],
                weapons: [rackWeapon],
                owned: [['nova:446', racks], ['nova:444', nukes]],
            });

            it('allows the sale when the racks left still hold them', () => {
                // 3 racks (24) with 16 aboard: two racks hold 16 exactly.
                expect(canSellOutfit(rack, rackContext(3, 16)))
                    .toEqual({ allowed: true });
            });

            it('names the shortfall, not the whole magazine', () => {
                // 2 racks (16) with 15 aboard: one rack holds 8, so 7 must
                // go -- not all 15.
                expect(canSellOutfit(rack, rackContext(2, 15))).toEqual({
                    allowed: false,
                    reason: 'ammoAboard',
                    message: 'You need to sell 7 units of ammunition before'
                        + ' you can sell your Nuke Storage Rack.',
                });
            });

            it('lets maxSellCount stop at the last sellable rack', () => {
                // 4 racks (32) with 17 aboard: 3 racks hold 24 and 2 hold
                // 16, so exactly one may go.
                expect(maxSellCount(rack, rackContext(4, 17))).toBe(1);
                // 9 aboard: down to 2 racks (16) is fine, 1 rack (8) is
                // not, so two may go.
                expect(maxSellCount(rack, rackContext(4, 9))).toBe(2);
                // Empty: all four.
                expect(maxSellCount(rack, rackContext(4, 0))).toBe(4);
            });

            it('agrees with a unit-by-unit scan on every boundary', () => {
                for (let racks = 1; racks <= 5; racks++) {
                    for (let nukes = 0; nukes <= 40; nukes++) {
                        const context = rackContext(racks, nukes);
                        // The straight-line answer: each sale must leave
                        // 8 x (racks - sold) >= nukes.
                        let scan = 0;
                        while (scan < racks
                            && 8 * (racks - (scan + 1)) >= nukes) {
                            scan++;
                        }
                        expect(maxSellCount(rack, context)).toBe(scan,
                            `${racks} racks, ${nukes} nukes`);
                    }
                }
            });

            it('does not check a weapon that merely draws on the supply',
                () => {
                    // The Nuke plug-in's split: oütf 445 "Missile Launcer"
                    // grants wëap 236, which FIRES nukes (its AmmoType
                    // draws on 238) but holds none. The racks are the
                    // magazine, so the tube sells freely with a full hold.
                    const tubeWeapon = makeWeapon('nova:236', {
                        ammoType: ['weapon', 'nova:238'], maxAmmo: 0,
                    });
                    const tube = makeOutfit('nova:445', {
                        name: 'Missile Launcer', max: 6,
                        weapons: { 'nova:236': 1 },
                    });
                    const context = makeContext({
                        outfits: [rack, tube, nuke],
                        weapons: [rackWeapon, tubeWeapon],
                        owned: [['nova:446', 1], ['nova:445', 1],
                            ['nova:444', 8]],
                    });
                    expect(canSellOutfit(tube, context))
                        .toEqual({ allowed: true });
                    // The rack it all hangs on is the one that is locked.
                    expect(canSellOutfit(rack, context)).toEqual(
                        jasmine.objectContaining({
                            allowed: false, reason: 'ammoAboard',
                        }));
                });
        });

        it('composes the sentence from the data set\'s own strings', () => {
            // A localised or modified STR# 2002 replaces the wording; the
            // count and the item name stay where the original puts them.
            const context = makeContext({
                outfits: [missileLauncher, missile],
                weapons: [missileWeapon],
                owned: [['nova:133', 1], ['nova:135', 3]],
            });
            expect(canSellOutfit(missileLauncher, {
                ...context,
                ammoSellStrings: {
                    needToSell: 'Dump', unit: 'round', units: 'rounds',
                    ofAmmunition: 'of ordnance', beforeYouCanSell: 'to shed',
                },
            })).toEqual(jasmine.objectContaining({
                message: 'Dump 3 rounds of ordnance to shed'
                    + ' IR Missile Launcher.',
            }));
        });
    });

    describe('negative free mass (STR# 2002 index 206)', () => {
        // A Mass Expansion: stock oütf 190 has Mass -10, i.e. it GRANTS
        // ten tons of outfit space. Selling it takes that space back.
        const expansion = makeOutfit('nova:190', { name: 'Mass Expansion' },
            { freeMass: -10 });
        const cargo = makeOutfit('nova:200', {}, { freeMass: 30 });

        it('refuses when the freed space is already spent', () => {
            // A hull with 20 tons, plus 10 from the expansion, with 30
            // tons installed: free mass is 0 and selling the expansion
            // would put it at -10.
            const context = makeContext({
                ship: makeShip({ freeMass: 20 }),
                outfits: [expansion, cargo],
                owned: [['nova:190', 1], ['nova:200', 1]],
            });
            expect(freeMass(context)).toBe(0);
            expect(canSellOutfit(expansion, context)).toEqual({
                allowed: false,
                reason: 'negativeFreeMass',
                message: NEGATIVE_FREE_MASS_REFUSAL,
            });
            expect(maxSellCount(expansion, context)).toBe(0);
        });

        it('allows the sale while the space it frees is spare', () => {
            const context = makeContext({
                ship: makeShip({ freeMass: 30 }),
                outfits: [expansion, cargo],
                owned: [['nova:190', 1], ['nova:200', 1]],
            });
            expect(canSellOutfit(expansion, context))
                .toEqual({ allowed: true });
        });

        it('stops the bulk sell at the units the hold can spare', () => {
            // Four expansions (40 tons granted) on a 20-ton hull with 30
            // tons of cargo pods installed: 30 tons spare, so three of
            // the four may go before the hold would go negative.
            const context = makeContext({
                ship: makeShip({ freeMass: 20 }),
                outfits: [expansion, cargo],
                owned: [['nova:190', 4], ['nova:200', 1]],
            });
            expect(freeMass(context)).toBe(30);
            expect(maxSellCount(expansion, context)).toBe(3);
        });
    });
});

describe('maxBuyCount', () => {
    it('is limited by the ship\'s free mass', () => {
        const outfit = makeOutfit('nova:200', {}, { freeMass: 30 });
        const context = makeContext({ outfits: [outfit] });
        // 100 tons free / 30 per unit = 3.
        expect(maxBuyCount(outfit, context)).toBe(3);
        // The simulation must not mutate the real outfit list.
        expect(context.outfits.get('nova:200')).toBeUndefined();
    });

    it('is limited by the effective Max including owned units', () => {
        const outfit = makeOutfit('nova:200', { max: 5 });
        const context = makeContext({
            outfits: [outfit],
            owned: [['nova:200', 3]],
        });
        expect(maxBuyCount(outfit, context)).toBe(2);
    });

    it('is zero when the availability test fails', () => {
        const outfit = makeOutfit('nova:200', { availability: 'b1' });
        expect(maxBuyCount(outfit, makeContext({ outfits: [outfit] })))
            .toBe(0);
    });

    it('caps effectively unlimited outfits at the bulk limit', () => {
        const outfit = makeOutfit('nova:200'); // No mass, no Max.
        const context = makeContext({ outfits: [outfit] });
        expect(maxBuyCount(outfit, context)).toBe(BULK_BUY_LIMIT);
        expect(maxBuyCount(outfit, context, 25)).toBe(25);
    });

    it('agrees with a unit-by-unit scan on every boundary (binary search)',
        () => {
            // The count is a binary search over the monotone gates; pin it
            // against the linear scan it replaced for the tight cases:
            // credits-limited, mass-limited, and the exact-fit boundary.
            const linear = (outfit: OutfitData, context: OutfitterContext,
                limit: number) => {
                const working = new Map(context.outfits);
                let count = 0;
                while (count < limit) {
                    if (!canBuyOutfit(outfit, {
                        ...context, outfits: working,
                        credits: context.credits - count * outfit.price,
                    }).allowed) {
                        break;
                    }
                    working.set(outfit.id, (working.get(outfit.id) ?? 0) + 1);
                    count++;
                }
                return count;
            };
            const cases: [OutfitData, OutfitterContext][] = [];
            for (const price of [1, 7, 33, 100]) {
                for (const freeMassUnit of [0, 3, 30, 101]) {
                    for (const credits of [0, 6, 99, 100, 5000]) {
                        const outfit = makeOutfit('nova:200', { price },
                            { freeMass: freeMassUnit });
                        cases.push([outfit,
                            makeContext({ outfits: [outfit], credits })]);
                    }
                }
            }
            for (const [outfit, context] of cases) {
                for (const limit of [0, 1, 2, 50, 2000]) {
                    expect(maxBuyCount(outfit, context, limit))
                        .toBe(linear(outfit, context, limit));
                }
            }
        });

    it('costs O(log n) purchase checks, not O(n)', () => {
        // 2000 chaingun rounds: the linear scan called canBuyOutfit 2000
        // times (each walking every owned outfit) and lagged the game.
        const outfit = makeOutfit('nova:200');
        const context = makeContext({ outfits: [outfit], credits: 1e9 });
        const spy = jasmine.createSpy('getOutfit').and.callFake(
            (id: string) => context.getOutfit(id));
        maxBuyCount(outfit, { ...context, getOutfit: spy }, 2000);
        // Well under the linear count; the exact number depends on how
        // many owned-outfit lookups one canBuyOutfit makes.
        expect(spy.calls.count()).toBeLessThan(200);
    });

    it('is limited by affordability (floor(credits/price))', () => {
        const outfit = makeOutfit('nova:200', { price: 1000 });
        // 3500 credits / 1000 each = 3 affordable.
        expect(maxBuyCount(outfit, makeContext({
            outfits: [outfit], credits: 3500,
        }))).toBe(3);
        // Exactly enough for 4.
        expect(maxBuyCount(outfit, makeContext({
            outfits: [outfit], credits: 4000,
        }))).toBe(4);
        // Can't afford even one.
        expect(maxBuyCount(outfit, makeContext({
            outfits: [outfit], credits: 999,
        }))).toBe(0);
    });

    it('takes the tighter of the mass and affordability bounds', () => {
        const outfit = makeOutfit('nova:200', { price: 1000 }, { freeMass: 30 });
        // Mass allows 3 (100/30), but credits only cover 2.
        expect(maxBuyCount(outfit, makeContext({
            outfits: [outfit], credits: 2500,
        }))).toBe(2);
    });

    it('is limited by launcher ammo capacity', () => {
        const launcherWeapon = makeWeapon('nova:300', {
            maxAmmo: 4,
            ammoType: ['weapon', 'nova:300'],
        });
        const launcher = makeOutfit('nova:201',
            { weapons: { 'nova:300': 1 } });
        const ammo = makeOutfit('nova:202', { ammoFor: 'nova:300' });
        const context = makeContext({
            outfits: [launcher, ammo],
            weapons: [launcherWeapon],
            owned: [['nova:201', 1], ['nova:202', 1]],
        });
        expect(maxBuyCount(ammo, context)).toBe(3);
    });
});

describe('maxSellCount', () => {
    it('is everything owned for a sellable outfit', () => {
        const outfit = makeOutfit('nova:200');
        const context = makeContext({
            outfits: [outfit],
            owned: [['nova:200', 7]],
        });
        expect(maxSellCount(outfit, context)).toBe(7);
    });

    it('is zero for unsellable or unowned outfits', () => {
        const unsellable = makeOutfit('nova:200', { cantSell: true });
        const context = makeContext({
            outfits: [unsellable],
            owned: [['nova:200', 7]],
        });
        expect(maxSellCount(unsellable, context)).toBe(0);
        const unowned = makeOutfit('nova:201');
        expect(maxSellCount(unowned, context)).toBe(0);
    });
});
