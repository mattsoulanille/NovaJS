import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { WeaponData } from 'novadatainterface/weapon_data';
import { GameDataAggregator }
    from '../server/parsing/game_data_aggregator.js';
import { getIntegrationGameData, getPluginGameData }
    from '../communication/simulation_test_fixture.js';
import {
    AMMO_SELL_INDICES,
    AMMO_SELL_STRINGS,
    AmmoSellStrings,
    ammoCapacity,
    canBuyOutfit,
    canSellOutfit,
    effectiveMax,
    freeMass,
    maxBuyCount,
    maxSellCount,
    NEGATIVE_FREE_MASS_INDEX,
    NEGATIVE_FREE_MASS_REFUSAL,
    OutfitterContext,
    SELL_REFUSAL_TABLE,
} from './outfitter_rules.js';

/**
 * The ammunition rules against the REAL game data, so both halves are
 * pinned to what the shipped game actually contains rather than to
 * hand-written fixtures.
 *
 * THE AMMO LIMIT RULE, as the data bears it out. An ammo oütf (ModType 3)
 * names a wëap in its ModVal -- the SUPPLY weapon, OutfitData.ammoFor --
 * and two fields decide how many rounds the player may hold:
 *
 *  - the ammo oütf's own Max field, multiplied by however many
 *    increase-maximum items (ModType 27) point at it (EVN Bible ~:1897,
 *    ~:1930); and
 *  - the SUPPLY weapon's MaxAmmo: "the maximum amount of ammo per each
 *    instance of this weapon ... Set to 0 or -1 if you want the ammo
 *    quantity to be constrained by the oütf resource's Max field instead"
 *    (~:3375).
 *
 * So MaxAmmo > 0 is the lever that makes ammunition need its magazine: the
 * limit is built entirely out of mounted instances of the supply weapon and
 * starts at zero. MaxAmmo <= 0 leaves the oütf Max as the only limit, and
 * that ammunition is buyable with no launcher at all -- which is what stock
 * data does for every ordinary missile.
 */
describe('the ammunition limit against real Nova data', () => {
    async function load(gameData: GameDataAggregator) {
        const ids = await gameData.ids;
        const outfits = new Map<string, OutfitData>(await Promise.all(
            [...ids.Outfit].map(async (id: string) =>
                [id, await gameData.data.Outfit.get(id)] as const)));
        const weapons = new Map<string, WeaponData>(await Promise.all(
            [...ids.Weapon].map(async (id: string) =>
                [id, await gameData.data.Weapon.get(id)] as const)));
        /**
         * A pilot who is not being gated by anything except the rule under
         * test: 1000 tons of hull space, unlimited credits, and a ship
         * Contribute of all ones so the stock Require bits (every stock
         * outfit sets at least 0x1) are covered. Control bits are given
         * per-spec, for the stock Availability expressions.
         */
        const context = (owned: [string, number][] = [],
            deployed?: [string, number][],
            bits: number[] = []): OutfitterContext => {
            const ship = getDefaultShipData();
            ship.physics = { ...ship.physics, freeMass: 1000 };
            ship.contribute = '0xffffffffffffffff';
            return {
                shipData: ship,
                outfits: new Map(owned),
                getOutfit: id => outfits.get(id),
                getWeapon: id => weapons.get(id),
                bits: new Set(bits),
                credits: Infinity,
                ...(deployed ? { deployedCounts: new Map(deployed) } : {}),
            };
        };
        return { outfits, weapons, context };
    }

    describe('stock data', () => {
        /**
         * Stock facts these lean on (the numeric part of a global id is the
         * classic resource id):
         *  - oütf 135 "IR Missile", Max 200, ammo for wëap 134 "IR Missile"
         *    (MaxAmmo 0), Availability "!b424". oütf 134 is the "IR Missile
         *    Launcher", which grants that same wëap 134.
         *  - oütf 158 "Viper", Max 9999, ammo for wëap 149 "Viper Bay"
         *    (MaxAmmo 4), Availability "b78 & P30". oütf 157 is the "Viper
         *    Bay" (Max 2), which grants wëap 149.
         *  - oütf 190 "Mass Expansion", Mass -10, sellable.
         */
        it('lets every ordinary missile be bought with no launcher', async () => {
            const { outfits, weapons, context } = await load(
                await getIntegrationGameData());
            // Not a lucky sample: EVERY stock ammo outfit whose supply
            // weapon leaves MaxAmmo at 0 must be freely buyable, and each
            // must carry a positive oütf Max as its only limit.
            const free = [...outfits.values()].filter(outfit =>
                outfit.ammoFor
                && (weapons.get(outfit.ammoFor)?.maxAmmo ?? 0) <= 0);
            expect(free.length).toBeGreaterThan(20);
            const empty = context();
            for (const outfit of free) {
                expect(ammoCapacity(outfit, empty))
                    .withContext(`${outfit.id} "${outfit.name}"`)
                    .toBeUndefined();
                expect(outfit.max)
                    .withContext(`${outfit.id} "${outfit.name}" oütf Max`)
                    .toBeGreaterThan(0);
                expect(effectiveMax(outfit, empty)).toBe(outfit.max);
            }

            // The IR Missile in particular: 200 of them, no launcher.
            const missile = outfits.get('nova:135')!;
            expect(missile.name).toBe('IR Missile');
            expect(missile.max).toBe(200);
            expect(weapons.get('nova:134')!.maxAmmo).toBe(0);
            expect(canBuyOutfit(missile, empty)).toEqual({ allowed: true });
            expect(maxBuyCount(missile, empty)).toBe(200);
            // And the launcher does not raise that ceiling: MaxAmmo 0 means
            // the oütf Max is the whole limit either way.
            expect(maxBuyCount(missile, context([['nova:134', 4]]))).toBe(200);
        });

        it('needs a bay before a single fighter can be bought', async () => {
            const { outfits, weapons, context } = await load(
                await getIntegrationGameData());
            const viper = outfits.get('nova:158')!;
            const bay = outfits.get('nova:157')!;
            expect([viper.name, bay.name]).toEqual(['Viper', 'Viper Bay']);
            // The fighter's own Max is effectively unlimited; the bay's
            // MaxAmmo is the real limit.
            expect(viper.max).toBe(9999);
            expect(weapons.get('nova:149')!.maxAmmo).toBe(4);

            // b78 is the bit the Viper's Availability wants (the carrier
            // storyline); without it the availability denial comes first.
            const noBay = context([], undefined, [78]);
            expect(ammoCapacity(viper, noBay)).toBe(0);
            expect(canBuyOutfit(viper, noBay)).toEqual(
                jasmine.objectContaining(
                    { allowed: false, reason: 'needsLauncher' }));

            const oneBay = context([['nova:157', 1]], undefined, [78]);
            expect(ammoCapacity(viper, oneBay)).toBe(4);
            expect(maxBuyCount(viper, oneBay)).toBe(4);
            expect(maxBuyCount(viper,
                context([['nova:157', 3]], undefined, [78]))).toBe(12);
        });

        it('sells the last IR Missile Launcher with rounds aboard',
            async () => {
                // RULING (Matthew, 2026-08-17): "You should be able to sell
                // an IR missile launcher even if you have IR missiles."
                // Nothing about the launchers mounted enters this
                // ammunition's ceiling -- wëap 134 leaves MaxAmmo at 0, so
                // the oütf Max of 200 governs alone -- and 12 rounds are
                // within it before and after the sale.
                const { outfits, context } = await load(
                    await getIntegrationGameData());
                const launcher = outfits.get('nova:134')!;
                expect(launcher.name).toBe('IR Missile Launcher');
                const loaded = context([['nova:134', 1], ['nova:135', 12]]);
                expect(canSellOutfit(launcher, loaded))
                    .toEqual({ allowed: true });
                expect(maxSellCount(launcher, loaded)).toBe(1);

                // And there is no count of launchers at which that turns:
                // all four go with a full 200-round hold aboard.
                expect(maxSellCount(launcher,
                    context([['nova:134', 4], ['nova:135', 200]]))).toBe(4);
            });

        it('refuses no ordinary stock launcher, whatever it is holding',
            async () => {
                // Not a lucky sample. Every stock outfit that grants a
                // supply weapon with MaxAmmo <= 0 must sell with that
                // weapon's ammunition aboard, since no such ceiling moves.
                const { outfits, weapons, context } = await load(
                    await getIntegrationGameData());
                let checked = 0;
                for (const outfit of outfits.values()) {
                    for (const weaponId of Object.keys(outfit.weapons)) {
                        if ((weapons.get(weaponId)?.maxAmmo ?? 0) > 0) {
                            continue;
                        }
                        const ammo = [...outfits.values()].find(
                            o => o.ammoFor === weaponId);
                        if (!ammo || outfit.cantSell) {
                            continue;
                        }
                        checked++;
                        expect(canSellOutfit(outfit, context(
                            [[outfit.id, 1], [ammo.id, 25]])))
                            .withContext(`${outfit.id} "${outfit.name}"`
                                + ` holding ${ammo.id} "${ammo.name}"`)
                            .toEqual({ allowed: true });
                    }
                }
                expect(checked).toBeGreaterThan(15);
            });

        it('refuses a Viper Bay by the shortfall in the bays left',
            async () => {
                const { outfits, context } = await load(
                    await getIntegrationGameData());
                const bay = outfits.get('nova:157')!;
                // Three bays (12 fighters) with 9 aboard: two bays hold 8,
                // so one fighter must go.
                expect(canSellOutfit(bay,
                    context([['nova:157', 3], ['nova:158', 9]]))).toEqual({
                        allowed: false,
                        reason: 'ammoAboard',
                        message: 'You need to sell 1 unit of ammunition'
                            + ' before you can sell your Viper Bay.',
                    });
                // With 8 aboard the two remaining bays hold them exactly.
                expect(canSellOutfit(bay,
                    context([['nova:157', 3], ['nova:158', 8]])))
                    .toEqual({ allowed: true });
                expect(maxSellCount(bay,
                    context([['nova:157', 3], ['nova:158', 8]]))).toBe(1);
            });

        it('tells the player to recall rather than sell deployed fighters',
            async () => {
                const { outfits, context } = await load(
                    await getIntegrationGameData());
                const bay = outfits.get('nova:157')!;
                // The whole complement launched, then landed: the fighters
                // cannot be sold to make room, so this is the recall
                // wording and not the ammunition sentence.
                expect(canSellOutfit(bay, context([['nova:157', 1]],
                    [['nova:158', 4]]))).toEqual(jasmine.objectContaining({
                        allowed: false, reason: 'fightersDeployed',
                    }));
            });

        it('refuses a Mass Expansion whose tonnage is already spent',
            async () => {
                const { outfits, context } = await load(
                    await getIntegrationGameData());
                const expansion = outfits.get('nova:190')!;
                expect(expansion.name).toBe('Mass Expansion');
                expect(expansion.physics.freeMass).toBe(-10);
                expect(expansion.cantSell).toBeFalse();

                // Fill the 1000-ton harness hull, plus the 10 tons the
                // expansion itself frees, with plain heavy ballast (an
                // outfit that grants no weapon, so no magazine rule is in
                // play) until under 10 tons are spare.
                const ballast = [...outfits.values()]
                    .filter(o => o.physics.freeMass > 0
                        && !Object.keys(o.weapons).length)
                    .sort((a, b) => b.physics.freeMass - a.physics.freeMass)[0];
                const units = Math.ceil(1001 / ballast.physics.freeMass);
                const full = context([['nova:190', 1], [ballast.id, units]]);
                expect(freeMass(full)).toBeLessThan(10);
                expect(canSellOutfit(expansion, full)).toEqual({
                    allowed: false,
                    reason: 'negativeFreeMass',
                    message: NEGATIVE_FREE_MASS_REFUSAL,
                });

                // With the ballast gone there is room to give the tonnage
                // back, so the same item sells.
                expect(canSellOutfit(expansion, context([['nova:190', 1]])))
                    .toEqual({ allowed: true });
            });
    });

    /**
     * The Nuclear Missile plug-in ('Nuke' directory) is the one bundled
     * data set that separates the three levers, and it is why the capacity
     * is read off the SUPPLY weapon:
     *
     *   oütf 444 "Nuclear Missile"   Max 120, ammo for wëap 238
     *   oütf 445 "Missile Launcer"   Max 6,  grants wëap 236 (fires nukes:
     *                                        AmmoType draws on 238,
     *                                        MaxAmmo 0)
     *   oütf 446 "Nuke Storage Rack" Max 15, grants wëap 238 (MaxAmmo 8)
     *
     * The rack is a dummy weapon that exists only to hold rounds, and 15
     * racks x 8 rounds is exactly the ammo outfit's Max of 120 -- the
     * author's two ceilings coincide, which is a good check that the
     * per-instance reading of MaxAmmo is the intended one.
     */
    describe('the Nuke plug-in', () => {
        it('builds the whole nuke limit out of storage racks', async () => {
            const gameData = await getPluginGameData('Nuke');
            if (!gameData) {
                pending('Nuke plug-in not installed');
                return;
            }
            const { outfits, weapons, context } = await load(gameData);
            const nuke = outfits.get('Nuke:444')!;
            const tube = outfits.get('Nuke:445')!;
            const rack = outfits.get('Nuke:446')!;
            expect([nuke.name, tube.name, rack.name]).toEqual(
                ['Nuclear Missile', 'Missile Launcer', 'Nuke Storage Rack']);
            expect(nuke.ammoFor).toBe('Nuke:238');
            expect(weapons.get('Nuke:238')!.maxAmmo).toBe(8);
            expect(weapons.get('Nuke:236')!.maxAmmo).toBe(0);
            expect(weapons.get('Nuke:236')!.ammoType)
                .toEqual(['weapon', 'Nuke:238']);

            // No rack, no nukes -- even with the tube that fires them.
            expect(ammoCapacity(nuke, context())).toBe(0);
            expect(canBuyOutfit(nuke, context([['Nuke:445', 6]]))).toEqual(
                jasmine.objectContaining(
                    { allowed: false, reason: 'needsLauncher' }));

            // Racks alone are enough to buy them: 8 per rack.
            expect(maxBuyCount(nuke, context([['Nuke:446', 1]]))).toBe(8);
            expect(maxBuyCount(nuke, context([['Nuke:446', 5]]))).toBe(40);
            // The author's two ceilings meet at the rack Max of 15.
            expect(ammoCapacity(nuke, context([['Nuke:446', 15]]))).toBe(120);
            expect(nuke.max).toBe(120);
            expect(maxBuyCount(nuke, context([['Nuke:446', 15]]))).toBe(120);
        });

        it('locks the racks, not the tube, when nukes are aboard',
            async () => {
                const gameData = await getPluginGameData('Nuke');
                if (!gameData) {
                    pending('Nuke plug-in not installed');
                    return;
                }
                const { outfits, context } = await load(gameData);
                const tube = outfits.get('Nuke:445')!;
                const rack = outfits.get('Nuke:446')!;
                const loaded = context([['Nuke:445', 1], ['Nuke:446', 2],
                    ['Nuke:444', 15]]);
                // The tube holds nothing, so it goes freely.
                expect(canSellOutfit(tube, loaded)).toEqual({ allowed: true });
                // A rack does hold them: 15 rounds, one rack left = 8.
                expect(canSellOutfit(rack, loaded)).toEqual({
                    allowed: false,
                    reason: 'ammoAboard',
                    message: 'You need to sell 7 units of ammunition before'
                        + ' you can sell your Nuke Storage Rack.',
                });
                expect(maxSellCount(rack, loaded)).toBe(0);
                // Down to 8 rounds and one rack may go.
                expect(maxSellCount(rack, context(
                    [['Nuke:446', 2], ['Nuke:444', 8]]))).toBe(1);
            });
    });

    /**
     * The refusal wording itself. Both sell refusals are STR# 2002 ("misc
     * strings", Nova Data 5.ndat) entries: 206 is the whole
     * negative-free-mass sentence and 207-211 are the five fragments the
     * launcher sentence is composed from. The numbering anchors already
     * cited elsewhere in the codebase are 52 "No response.", 172
     * "Forbidden", and 222/223, the two "There are no ships available for"
     * lines.
     */
    describe('the sell refusals in STR# 2002', () => {
        it('matches the stock strings the rules fall back to', async () => {
            const gameData = await getIntegrationGameData();
            const table = await gameData.data.StringTable.get(
                SELL_REFUSAL_TABLE);

            // The anchors, so a shifted table fails loudly here rather
            // than quietly composing the wrong sentence.
            expect(table.strings[52]).toBe('No response.');
            expect(table.strings[172]).toBe('Forbidden');
            expect(table.strings[222])
                .toBe('There are no ships available for purchase here.');
            expect(table.strings[223])
                .toBe('There are no ships available for hire.');

            expect(table.strings[NEGATIVE_FREE_MASS_INDEX])
                .toBe(NEGATIVE_FREE_MASS_REFUSAL);
            for (const key of Object.keys(AMMO_SELL_INDICES) as
                (keyof AmmoSellStrings)[]) {
                expect(table.strings[AMMO_SELL_INDICES[key]])
                    .withContext(`STR# 2002 index ${AMMO_SELL_INDICES[key]}`)
                    .toBe(AMMO_SELL_STRINGS[key]);
            }
        });
    });
});
