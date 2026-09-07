import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultProjectileWeaponData, WeaponData } from 'novadatainterface/weapon_data';
import {
    DISCOVERY_ENTERED, DISCOVERY_UNKNOWN, DiscoveryAccess,
} from '../nova_plugin/player/index.js';
import {
    ammoCapacity,
    availableForSale,
    BULK_BUY_LIMIT,
    canBuyOutfit,
    canSellOutfit,
    effectiveMax,
    freeCargo,
    freeMass,
    installedMass,
    maxBuyCount,
    maxSellCount,
    NEGATIVE_FREE_MASS_REFUSAL,
    neverOnSale,
    OUTFIT_RESALE_FRACTION,
    outfitPrice,
    outfitResaleValue,
    OutfitterContext,
    OutfitterStellar,
    playerContribute,
    requireApplies,
    requirementsMet,
    sellRefund,
    stellarStocks,
    visibleOutfits,
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
        // As real data does for everything but a plug-in's OVERRIDE of a
        // stock resource, which keeps the stock id and is the one case a
        // spec has to state a differing writerPrefix explicitly.
        prefix: idPrefix(id),
        writerPrefix: idPrefix(id),
        ...outfit,
        physics: { freeMass: 0, ...physics },
    };
}

/** The prefix half of a global id, as novaparse assigns it. */
function idPrefix(id: string): string {
    const colon = id.lastIndexOf(':');
    return colon < 0 ? 'nova' : id.slice(0, colon);
}

function makeWeapon(id: string, weapon: Partial<WeaponData> = {}): WeaponData {
    return { ...getDefaultProjectileWeaponData(), id, ...weapon } as WeaponData;
}

function makeContext({ ship, outfits, weapons, owned, bits, credits,
    deployed, discovery, systemExists, planet }: {
        ship?: ShipData,
        outfits?: OutfitData[],
        weapons?: WeaponData[],
        owned?: [string, number][],
        bits?: number[],
        credits?: number,
        /** Owned but not aboard — bay fighters still in flight. */
        deployed?: [string, number][],
        /** The pilot's map knowledge, for an Availability's Exxx. */
        discovery?: DiscoveryAccess,
        systemExists?: (globalId: string) => boolean,
        /** The docked stellar; absent stocks everything. */
        planet?: OutfitterStellar,
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
        ...(discovery ? { discovery } : {}),
        ...(systemExists ? { systemExists } : {}),
        ...(planet ? { planet } : {}),
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

    it('resolves an Oxxx written by the plug-in that OVERRODE a stock outfit',
        () => {
            // The Extra Outfits afterburner shape: the plug-in overrides
            // stock oütf 197 purely to add `!o548`, naming its OWN oütf 548.
            // The override keeps the stock id, so the id's prefix says
            // "nova" and only writerPrefix knows who wrote the expression;
            // reading the id's prefix looked for a stock outfit 548 that
            // does not exist and left the term permanently false.
            const firstGen = makeOutfit('nova:197', {
                availability: '!o548', writerPrefix: 'plug',
            });
            const secondGen = makeOutfit('plug:548');
            expect(canBuyOutfit(firstGen, makeContext({
                outfits: [firstGen, secondGen],
                owned: [['plug:548', 1]],
            }))).toEqual(jasmine.objectContaining(
                { allowed: false, reason: 'availability' }));
            expect(canBuyOutfit(firstGen, makeContext({
                outfits: [firstGen, secondGen],
            }))).toEqual({ allowed: true });
        });

    it('still prefers the stock id when stock defines that number', () => {
        // The mirror case, and why the stock lookup comes FIRST: the
        // plug-in's own `!o197` means the (overridden) stock afterburner,
        // not some plug:197 of its own.
        const secondGen = makeOutfit('plug:548', { availability: '!o197' });
        const firstGen = makeOutfit('nova:197', { writerPrefix: 'plug' });
        expect(canBuyOutfit(secondGen, makeContext({
            outfits: [firstGen, secondGen],
            owned: [['nova:197', 1]],
        }))).toEqual(jasmine.objectContaining(
            { allowed: false, reason: 'availability' }));
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

    it('lets availability check where the pilot has been with Exxx', () => {
        // Bible :157, "Returns 1 if the player has explored system ID xxx".
        // The shop is a player-local screen, so this is the local pilot's
        // record; the sÿst number is scoped to the OUTFIT's own plug-in,
        // stock first, exactly as its Oxxx is.
        const gated = makeOutfit('nova:200', { availability: 'E130' });
        const explored = (ids: string[]) => makeContext({
            discovery: {
                level: id => ids.includes(id)
                    ? DISCOVERY_ENTERED : DISCOVERY_UNKNOWN,
                markVisited: () => { },
            },
            systemExists: id => id === 'nova:130' || id === 'plug:130',
        });
        expect(canBuyOutfit(gated, explored(['nova:130'])))
            .toEqual({ allowed: true });
        expect(canBuyOutfit(gated, explored([]))).toEqual(
            jasmine.objectContaining(
                { allowed: false, reason: 'availability' }));
        // A plug-in outfit's E130 still means stock's 130 when stock has
        // one; the plug-in's own only when it does not.
        const pluginOutfit = makeOutfit('plug:200', { availability: 'E130' });
        expect(canBuyOutfit(pluginOutfit, explored(['plug:130']))).toEqual(
            jasmine.objectContaining(
                { allowed: false, reason: 'availability' }));
        // With no discovery record at all, Exxx is false (the unwired
        // default) — the pre-existing behaviour.
        expect(canBuyOutfit(gated, makeContext())).toEqual(
            jasmine.objectContaining(
                { allowed: false, reason: 'availability' }));
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

    it('refuses a cargo-consuming outfit when the freight aboard would '
        + 'no longer fit', () => {
            // A Mass Expansion (stock 190, cargo -15) on a 20-ton hold
            // with 20 tons of freight: capacity would stay positive (5)
            // but the hold would be over capacity by 15.
            const expansion = makeOutfit('nova:190', {}, { freeCargo: -15 });
            const full = {
                ...makeContext({ ship: makeShip({ freeCargo: 20 }) }),
                cargoUsed: 20,
            };
            expect(canBuyOutfit(expansion, full)).toEqual(
                jasmine.objectContaining({ allowed: false, reason: 'cargo' }));
            // Five tons of freight leaves exactly the 5-ton hold.
            expect(canBuyOutfit(expansion, { ...full, cargoUsed: 5 }))
                .toEqual({ allowed: true });
            // An absent cargoUsed is an empty hold (every older spec).
            expect(canBuyOutfit(expansion,
                makeContext({ ship: makeShip({ freeCargo: 20 }) })))
                .toEqual({ allowed: true });
        });

    it('refuses any cargo-consuming outfit on a no-mass-expansions hull '
        + '(shïp Holds < 0)', () => {
            const expansion = makeOutfit('nova:190', {}, { freeCargo: -15 });
            const hull = makeShip({ freeCargo: 60 }, { noMassExpansions: true });
            expect(canBuyOutfit(expansion, makeContext({ ship: hull })))
                .toEqual(jasmine.objectContaining(
                    { allowed: false, reason: 'noMassExpansions' }));
            // Cargo EXPANSIONS (positive) and everything else are fine.
            const cargoPod = makeOutfit('nova:189', {}, { freeCargo: 10 });
            expect(canBuyOutfit(cargoPod, makeContext({ ship: hull })))
                .toEqual({ allowed: true });
            expect(canBuyOutfit(makeOutfit('nova:129'),
                makeContext({ ship: hull }))).toEqual({ allowed: true });
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

    it('refuses an item with BuyRandom 0, which is never put on sale', () => {
        const never = makeOutfit('nova:200', { buyRandom: 0 });
        expect(canBuyOutfit(never, makeContext({ outfits: [never] })))
            .toEqual(jasmine.objectContaining(
                { allowed: false, reason: 'notStocked' }));
        // A positive value is just "offered"; NovaJS doesn't roll the
        // daily chance, and >100 is the Bible's own "means 100".
        for (const buyRandom of [1, 55, 100, 120]) {
            expect(canBuyOutfit(makeOutfit('nova:200', { buyRandom }),
                makeContext())).withContext(`BuyRandom ${buyRandom}`)
                .toEqual({ allowed: true });
        }
    });
});

describe('neverOnSale (oütf BuyRandom 0)', () => {
    it('keeps the item off the shelves entirely', () => {
        const never = makeOutfit('nova:200', { buyRandom: 0 });
        const sold = makeOutfit('nova:201', { buyRandom: 40 });
        const context = makeContext({ outfits: [never, sold] });
        expect(neverOnSale(never)).toBe(true);
        expect(neverOnSale(sold)).toBe(false);
        expect(visibleOutfits([never, sold], context).map(o => o.id))
            .toEqual(['nova:201']);
        expect(availableForSale(never, context)).toBe(false);
        expect(availableForSale(sold, context)).toBe(true);
    });

    it('still lets an owned unit be shown and sold back', () => {
        // Mission-granted junk routinely has BuyRandom 0; it exists to be
        // dumped for credits, so the shop must still take it.
        const never = makeOutfit('nova:200', { buyRandom: 0, price: 1000 });
        const context = makeContext({
            outfits: [never], owned: [['nova:200', 1]],
        });
        expect(visibleOutfits([never], context).map(o => o.id))
            .toEqual(['nova:200']);
        expect(canSellOutfit(never, context)).toEqual({ allowed: true });
        expect(canBuyOutfit(never, context)).toEqual(jasmine.objectContaining(
            { allowed: false, reason: 'notStocked' }));
    });

    it('does not suppress a higher-numbered equal-DispWeight item', () => {
        // The 0x1000 exclusion is driven only by items that are themselves
        // available FOR SALE, and one that is never offered is not.
        const never = makeOutfit('nova:200', {
            buyRandom: 0, displayWeight: 50, excludesEqualDisplayWeight: true,
        });
        const other = makeOutfit('nova:201', { displayWeight: 50 });
        expect(visibleOutfits([never, other],
            makeContext({ outfits: [never, other] })).map(o => o.id))
            .toEqual(['nova:201']);
    });

    it('gates on stellar tech level as well (stellarStocks)', () => {
        const stellar = { techLevel: 5, specialTech: [81] };
        expect(stellarStocks(makeOutfit('nova:200', { techLevel: 3 }), stellar))
            .toBe(true);
        expect(stellarStocks(makeOutfit('nova:201', { techLevel: 81 }), stellar))
            .toBe(true);
        expect(stellarStocks(makeOutfit('nova:202', { techLevel: 80 }), stellar))
            .toBe(false);
        expect(stellarStocks(
            makeOutfit('nova:203', { techLevel: 3, buyRandom: 0 }), stellar))
            .toBe(false);
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
        // constrained by the oütf Max field alone -- freely buyable with
        // no launcher at all, and (Matthew's ruling) freely sellable out
        // from under the rounds, because no launcher coming or going can
        // move that ceiling. See THE LAUNCHER SELL RULE beside
        // canSellOutfit.
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

        it('sells the last launcher with its magazine still loaded', () => {
            // RULING (Matthew, 2026-08-17): "You should be able to sell an
            // IR missile launcher even if you have IR missiles." The 50
            // rounds are within their oütf Max of 200 before the sale and
            // still within it after, so there is no shortfall to report --
            // they stay in the hold as ammunition the ship cannot fire.
            const context = missileContext(
                [['nova:133', 1], ['nova:135', 50]]);
            expect(canSellOutfit(missileLauncher, context))
                .toEqual({ allowed: true });
            // The greyed Sell button and the bulk-sell dialog both read
            // through maxSellCount, so they agree for free.
            expect(maxSellCount(missileLauncher, context)).toBe(1);
        });

        it('sells every launcher, however many rounds are aboard', () => {
            // Nothing about the count of launchers enters the ceiling when
            // MaxAmmo <= 0, so there is no n at which the sale turns.
            const context = missileContext(
                [['nova:133', 3], ['nova:135', 200]]);
            expect(maxSellCount(missileLauncher, context)).toBe(3);
        });

        it('leaves the ammunition itself sellable', () => {
            // Ammo grants no weapon, so it is nobody's magazine.
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

            it('uses the singular unit word for one round (STR# 208)', () => {
                // 1 rack with 1 aboard: the last rack holds nothing, so
                // exactly one round is over.
                expect(canSellOutfit(rack, rackContext(1, 1))).toEqual(
                    jasmine.objectContaining({
                        message: 'You need to sell 1 unit of ammunition'
                            + ' before you can sell your Nuke Storage Rack.',
                    }));
            });

            it('composes the sentence from the data set\'s own strings',
                () => {
                    // A localised or modified STR# 2002 replaces the
                    // wording; the count and the item name stay where the
                    // original puts them.
                    expect(canSellOutfit(rack, {
                        ...rackContext(1, 3),
                        ammoSellStrings: {
                            needToSell: 'Dump', unit: 'round',
                            units: 'rounds', ofAmmunition: 'of ordnance',
                            beforeYouCanSell: 'to shed',
                        },
                    })).toEqual(jasmine.objectContaining({
                        message: 'Dump 3 rounds of ordnance to shed'
                            + ' Nuke Storage Rack.',
                    }));
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

        it('strands no fighter when the last uncapped bay goes', () => {
            // The one place the deployed half parts company with the
            // capacity rule: stock wëap 177-180 are bays with MaxAmmo 0,
            // so nothing above would report a shortfall -- but a fighter
            // in FLIGHT is dropped outright when the carrier mounts no bay
            // (refundFighterToBay), which is not the same event as holding
            // a round you cannot fire.
            const uncappedBay = makeWeapon('nova:177', {
                ammoType: ['weapon', 'nova:177'], maxAmmo: 0,
            });
            const bay = makeOutfit('nova:306', {
                name: 'Viper Bay', weapons: { 'nova:177': 1 },
            });
            const viper = makeOutfit('nova:307', {
                name: 'Viper', max: 9999, ammoFor: 'nova:177',
            });
            const bays = (count: number, aboard: number, out: number) =>
                makeContext({
                    outfits: [bay, viper],
                    weapons: [uncappedBay],
                    owned: [['nova:306', count], ['nova:307', aboard]],
                    deployed: [['nova:307', out]],
                });

            // Last bay, one fighter out: refused, and it is the recall
            // wording because the fighter cannot be sold to fix it.
            expect(canSellOutfit(bay, bays(1, 0, 1))).toEqual(
                jasmine.objectContaining({
                    allowed: false, reason: 'fightersDeployed',
                }));
            // A second bay survives the sale, so nothing is stranded.
            expect(canSellOutfit(bay, bays(2, 0, 1)))
                .toEqual({ allowed: true });
            // Fighters merely ABOARD an uncapped bay do not block it:
            // they stay in the hold, exactly like IR Missiles.
            expect(canSellOutfit(bay, bays(1, 4, 0)))
                .toEqual({ allowed: true });
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

    describe('granted cargo space and hardpoints (the twins of that rule)',
        () => {
            /** A Cargo Expansion: stock 189, +10 tons of hold. */
            const cargoPod = makeOutfit('nova:189', {}, { freeCargo: 10 });
            /** Sigma Mount Reinforcement: stock 335, +4 guns, +2 turrets. */
            const mounts = makeOutfit('nova:335', {},
                { maxGuns: 4, maxTurrets: 2 });
            const gun = makeOutfit('nova:129', { fixedGun: true });
            const turret = makeOutfit('nova:131', { turret: true });

            it('refuses to sell a Cargo Expansion the freight is using', () => {
                // 20-ton hull + 10 = 30 tons, 25 aboard.
                const context = {
                    ...makeContext({
                        ship: makeShip({ freeCargo: 20 }),
                        outfits: [cargoPod], owned: [['nova:189', 1]],
                    }),
                    cargoUsed: 25,
                };
                expect(canSellOutfit(cargoPod, context)).toEqual(
                    jasmine.objectContaining(
                        { allowed: false, reason: 'cargoAboard' }));
                expect(canSellOutfit(cargoPod, { ...context, cargoUsed: 20 }))
                    .toEqual({ allowed: true });
                expect(canSellOutfit(cargoPod, makeContext({
                    ship: makeShip({ freeCargo: 20 }),
                    outfits: [cargoPod], owned: [['nova:189', 1]],
                }))).toEqual({ allowed: true });
            });

            it('refuses to sell the mounts the guns are hanging on', () => {
                // A 2-gun / 1-turret hull with the reinforcement: 6 guns,
                // 3 turrets. Five guns mounted need it; two do not.
                const armed = (guns: number, turrets: number) => makeContext({
                    ship: makeShip({ maxGuns: 2, maxTurrets: 1 }),
                    outfits: [mounts, gun, turret],
                    owned: [['nova:335', 1], ['nova:129', guns],
                        ['nova:131', turrets]],
                });
                expect(canSellOutfit(mounts, armed(5, 0))).toEqual(
                    jasmine.objectContaining(
                        { allowed: false, reason: 'hardpoints' }));
                expect(canSellOutfit(mounts, armed(0, 2))).toEqual(
                    jasmine.objectContaining(
                        { allowed: false, reason: 'hardpoints' }));
                expect(canSellOutfit(mounts, armed(2, 1)))
                    .toEqual({ allowed: true });
                expect(maxSellCount(mounts, armed(3, 0))).toBe(0);
            });
        });
});

describe('oütf RequireGovt (where the Require bits are enforced)', () => {
    /** The stock Medium Blaster: Require the Heavy Weapons License bit,
     * scoped to the Federation (RequireGovt 128). */
    const blaster = makeOutfit('nova:129', {
        require: '0x100000001', requireGovt: 'nova:128',
        requireGovtScope: 'govtOrAllies',
    });
    const FEDERATION = 'nova:128';
    const AURORA = 'nova:129';
    /** Vell-os (nova:136) is allied with the Federation's class. */
    const VELLOS = 'nova:136';
    const allied = (govt: string, other: string) =>
        govt === FEDERATION && other === VELLOS;
    const stellar = (govt: string | null | undefined) => ({
        techLevel: 7, specialTech: [], buysAnyOutfit: false,
        ...(govt === undefined ? {} : { govt }),
    });
    /** A hull whose Contribute is only the base bit: no licence. */
    const unlicensed = (govt: string | null | undefined) => ({
        ...makeContext({
            ship: makeShip({}, { contribute: '0x1' }), outfits: [blaster],
            planet: stellar(govt),
        }),
        govtAllied: allied,
    });

    it('enforces a govt-scoped Require at that govt\'s own stellars', () => {
        expect(requireApplies(blaster, unlicensed(FEDERATION))).toBe(true);
        expect(requirementsMet(blaster, unlicensed(FEDERATION))).toBe(false);
        expect(canBuyOutfit(blaster, unlicensed(FEDERATION))).toEqual(
            jasmine.objectContaining({ allowed: false, reason: 'require' }));
    });

    it('...and at its allies\', but nowhere else', () => {
        expect(requireApplies(blaster, unlicensed(VELLOS))).toBe(true);
        expect(requireApplies(blaster, unlicensed(AURORA))).toBe(false);
        expect(requireApplies(blaster, unlicensed(null))).toBe(false);
        expect(requirementsMet(blaster, unlicensed(AURORA))).toBe(true);
        expect(canBuyOutfit(blaster, unlicensed(AURORA)))
            .toEqual({ allowed: true });
    });

    it('applies everywhere with no stellar, or for scope "all"', () => {
        expect(requireApplies(blaster, {
            ...makeContext({ outfits: [blaster] }), govtAllied: allied,
        })).toBe(true);
        const everywhere = makeOutfit('nova:147', {
            require: '0x2', requireGovt: null, requireGovtScope: 'all',
        });
        expect(requireApplies(everywhere, unlicensed(AURORA))).toBe(true);
    });

    it('reads the other three scopes as the Bible words them', () => {
        const scoped = (scope: OutfitData['requireGovtScope']) =>
            makeOutfit('nova:200', {
                require: '0x2', requireGovt: FEDERATION, requireGovtScope: scope,
            });
        // 1128-1383: independent stellars and the govt/allies.
        expect(requireApplies(scoped('independentOrGovt'), unlicensed(null)))
            .toBe(true);
        expect(requireApplies(scoped('independentOrGovt'), unlicensed(VELLOS)))
            .toBe(true);
        expect(requireApplies(scoped('independentOrGovt'), unlicensed(AURORA)))
            .toBe(false);
        // 2128-2383: everywhere EXCEPT the govt/allies.
        expect(requireApplies(scoped('exceptGovt'), unlicensed(FEDERATION)))
            .toBe(false);
        expect(requireApplies(scoped('exceptGovt'), unlicensed(AURORA)))
            .toBe(true);
        expect(requireApplies(scoped('exceptGovt'), unlicensed(null)))
            .toBe(true);
        // 3128-3383: everywhere except independents and the govt/allies.
        expect(requireApplies(scoped('exceptIndependentOrGovt'),
            unlicensed(null))).toBe(false);
        expect(requireApplies(scoped('exceptIndependentOrGovt'),
            unlicensed(VELLOS))).toBe(false);
        expect(requireApplies(scoped('exceptIndependentOrGovt'),
            unlicensed(AURORA))).toBe(true);
    });

    it('never waives a licence when the stellar\'s govt is unknown', () => {
        // A stellar with no `govt` field: treated as not belonging to the
        // govt, so 'govtOrAllies' does not fire (the requirement is
        // waived only where the original would ALSO waive it: never at a
        // Federation world, which this cannot be shown to be).
        expect(requireApplies(blaster, unlicensed(undefined))).toBe(false);
        // ...and without an ally lookup only an exact match counts.
        const noAllies = { ...unlicensed(VELLOS), govtAllied: undefined };
        expect(requireApplies(blaster, noAllies)).toBe(false);
        expect(requireApplies(blaster,
            { ...unlicensed(FEDERATION), govtAllied: undefined })).toBe(true);
    });
});

describe('ship-mass-proportional outfits (oütf flags 0x0200 / 0x0400)', () => {
    /**
     * Carbon Fiber as stock oütf 180 is written: Cost 250, Mass 1, both
     * bits set. "Ship class Mass field is multiplied by this item's Cost
     * field" and "multiplied by this item's Mass field and then divided
     * by 100" (EVN Bible ~:1974-1979).
     */
    const carbonFiber = makeOutfit('nova:180', {
        name: 'Carbon Fiber', price: 250,
        priceScalesWithShipMass: true, massScalesWithShipMass: true,
    }, { freeMass: 1 });
    /** Spun Diamond (oütf 183): Cost 2,500, Mass 1. */
    const spunDiamond = makeOutfit('nova:183', {
        price: 2500, priceScalesWithShipMass: true,
        massScalesWithShipMass: true,
    }, { freeMass: 1 });
    /** A Heavy Shuttle (shïp 129, Mass 25) and a Leviathan (131, 10,000). */
    const heavyShuttle = makeShip({ mass: 25, freeMass: 3 });
    const leviathan = makeShip({ mass: 10_000, freeMass: 500 });

    it('prices at Cost x ship mass: the 6,250 cr of the Earth capture', () => {
        // outfitter/earth_outfitter_carbon_fiber_cant_hold_any_more.png
        // reads "Item Price: 6,250 cr" for Carbon Fiber on a mass-25 hull.
        expect(outfitPrice(carbonFiber, heavyShuttle)).toBe(6_250);
        expect(outfitPrice(carbonFiber, leviathan)).toBe(2_500_000);
        expect(outfitPrice(spunDiamond, leviathan)).toBe(25_000_000);
        // Unflagged outfits are untouched by the hull.
        expect(outfitPrice(makeOutfit('nova:129', { price: 20_000 }),
            leviathan)).toBe(20_000);
    });

    it('installs at ship mass x Mass / 100, rounded up to a whole ton', () => {
        expect(installedMass(carbonFiber, leviathan)).toBe(100);
        // 25 x 1 / 100 = 0.25, shown as "Item Mass: 1 ton" in the capture.
        expect(installedMass(carbonFiber, heavyShuttle)).toBe(1);
    });

    it('charges the scaled price and checks the scaled mass on Buy', () => {
        const rich = makeContext({
            ship: leviathan, outfits: [carbonFiber], credits: 2_500_000,
        });
        expect(canBuyOutfit(carbonFiber, rich)).toEqual({ allowed: true });
        const poor = makeContext({
            ship: leviathan, outfits: [carbonFiber], credits: 2_499_999,
        });
        expect(canBuyOutfit(carbonFiber, poor)).toEqual(
            jasmine.objectContaining({ allowed: false, reason: 'credits' }));
        // 500 tons free on the Leviathan: five plates (100 t each) fit,
        // and the sixth does not, whatever the flat Mass 1 says.
        const full = makeContext({
            ship: leviathan, outfits: [carbonFiber],
            owned: [['nova:180', 5]],
        });
        expect(freeMass(full)).toBe(0);
        expect(canBuyOutfit(carbonFiber, full)).toEqual(
            jasmine.objectContaining({ allowed: false, reason: 'mass' }));
    });

    it('reproduces the capture: three plates fill a 3-ton hold', () => {
        // The reference pilot owns 3 Carbon Fiber, sees "Available: 0
        // tons" and "Can't hold any more!" (the mass denial).
        const context = makeContext({
            ship: heavyShuttle, outfits: [carbonFiber],
            owned: [['nova:180', 3]],
        });
        expect(freeMass(context)).toBe(0);
        expect(canBuyOutfit(carbonFiber, context)).toEqual(
            jasmine.objectContaining({ allowed: false, reason: 'mass' }));
    });

    it('bounds the bulk buy by the scaled price and mass', () => {
        const context = makeContext({
            ship: leviathan, outfits: [carbonFiber], credits: 7_500_000,
        });
        // 3 affordable at 2.5M each (5 would fit by mass).
        expect(maxBuyCount(carbonFiber, context)).toBe(3);
    });

    it('sells back at half the SCALED price, so no hull can mint credits',
        () => {
            expect(outfitResaleValue(carbonFiber, leviathan)).toBe(1_250_000);
            expect(sellRefund(carbonFiber, 1, leviathan).credited)
                .toBe(2_500_000);
            expect(sellRefund(carbonFiber, 0, heavyShuttle).credited)
                .toBe(3_125);
        });

    it('is quoted unscaled with no hull in hand', () => {
        expect(outfitPrice(carbonFiber)).toBe(250);
        expect(installedMass(carbonFiber)).toBe(1);
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
