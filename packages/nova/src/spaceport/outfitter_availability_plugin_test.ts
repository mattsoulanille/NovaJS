import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { getPluginGameData } from '../communication/simulation_test_fixture.js';
import { GameDataAggregator }
    from '../server/parsing/game_data_aggregator.js';
import {
    availabilityTest, canBuyOutfit, canSellOutfit, meetsTechLevel,
    neverOnSale, OutfitterContext, requirementsMet, stellarOf, visibleOutfits,
} from './outfitter_rules.js';

/**
 * What the outfitter LISTS and what it will SELL, against real third-party
 * plug-in data, for the three playtest reports that pinned the rules down:
 *
 *  1. Extra Outfits' first-generation Afterburner / Solar Panels / Battery
 *     Pack stayed buyable with the second generation installed. Those three
 *     are plug-in OVERRIDES of stock oütf 197 / 228 / 256, whose whole
 *     point is the added Availability `!o548` / `!o593` / `!o594` naming the
 *     plug-in's own successors. An override keeps the stock id, so the Oxxx
 *     resolution has to go by the WRITING plug-in (BaseData.writerPrefix),
 *     not by the id's prefix.
 *  2. Extra Outfits' oütf 524 "TAM Drone PD Laser" and 592 "TO Drone
 *     Offensive Laser" were on the shelf at its Tektaara Station (spöb 800,
 *     TechLevel -1, SpecialTech 10000), which stocks everything at TechLevel
 *     exactly 10000. Their dësc reads "Unused description. If you can read
 *     this something isn't working as intended." The one field that says so
 *     in the data is BuyRandom 0 (see neverOnSale).
 *  3. More Blasters' Hyperioid cell samples. NOT a NovaJS bug: the installed
 *     CHEAT variant deliberately unlocks them, and the shipped non-cheat
 *     file gates them twice over. The two variants' fields are pinned below.
 */
describe('outfitter listing against real plug-in data', () => {
    /** Everything a probe needs to ask "what does this shop show?". */
    interface Bench {
        gameData: GameDataAggregator;
        outfits: Map<string, OutfitData>;
        context(planetId: string, owned?: [string, number][],
            bits?: number[]): Promise<OutfitterContext>;
        listed(planetId: string, owned?: [string, number][],
            bits?: number[]): Promise<string[]>;
    }

    async function bench(plugin: string | string[]):
        Promise<Bench | undefined> {
        const gameData = await getPluginGameData(plugin);
        if (!gameData) {
            return undefined;
        }
        const ids = await gameData.ids;
        const outfits = new Map<string, OutfitData>();
        for (const id of ids.Outfit) {
            outfits.set(id, await gameData.data.Outfit.get(id));
        }
        const weapons = new Map(await Promise.all(ids.Weapon.map(
            async id => [id, await gameData.data.Weapon.get(id)] as const)));
        // The Terrapin: enough free mass and hardpoints that nothing here
        // is denied for a reason other than the one under test.
        const shipData = await gameData.data.Ship.get('nova:136');
        const context = async (planetId: string, owned: [string, number][] = [],
            bits: number[] = []): Promise<OutfitterContext> => ({
                shipData,
                outfits: new Map(owned),
                getOutfit: id => outfits.get(id),
                getWeapon: id => weapons.get(id),
                bits: new Set(bits),
                credits: 1e9,
                planet: stellarOf(await gameData.data.Planet.get(planetId)),
            });
        return {
            gameData, outfits, context,
            listed: async (planetId, owned, bits) =>
                visibleOutfits([...outfits.values()],
                    await context(planetId, owned, bits)).map(o => o.id),
        };
    }

    describe('Extra Outfits first/second generation pairs', () => {
        const PLUGIN = 'extra-outfits';
        /** Earth: TechLevel 7, which stocks all six of these. */
        const EARTH = 'nova:128';
        /**
         * [first generation (a plug-in override of a stock oütf), second
         * generation (the plug-in's own)], with the first's Availability.
         */
        const PAIRS = [
            ['nova:197', 'extra-outfits:548', '!o548 & P30'],
            ['nova:228', 'extra-outfits:593', '!o593'],
            ['nova:256', 'extra-outfits:594', '!o594'],
        ] as const;

        it('parses the pairs the way the report describes them', async () => {
            const b = await bench(PLUGIN);
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            for (const [firstId, secondId, availability] of PAIRS) {
                const first = b.outfits.get(firstId)!;
                const second = b.outfits.get(secondId)!;
                // The override keeps the stock id but is written by the
                // plug-in — the whole reason writerPrefix has to exist.
                expect(first.prefix).withContext(firstId).toBe('nova');
                expect(first.writerPrefix).withContext(firstId).toBe(PLUGIN);
                expect(first.availability).withContext(firstId)
                    .toBe(availability);
                expect(second.availability).withContext(secondId)
                    .toBe(`!o${firstId.slice('nova:'.length)}`);
                // Neither carries the 0x4000 hide flag, so a first-gen item
                // whose Availability has gone false still SHOWS — greyed.
                expect(first.hideUnlessAvailable).withContext(firstId)
                    .toBe(false);
            }
        });

        it('stops selling the first generation once the second is aboard, '
            + 'and resumes when it is sold again', async () => {
                const b = await bench(PLUGIN);
                if (!b) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                for (const [firstId, secondId] of PAIRS) {
                    const first = b.outfits.get(firstId)!;
                    const before = await b.context(EARTH);
                    expect(canBuyOutfit(first, before))
                        .withContext(`${firstId} with nothing owned`)
                        .toEqual({ allowed: true });

                    const after = await b.context(EARTH, [[secondId, 1]]);
                    expect(availabilityTest(first, after))
                        .withContext(`${firstId} Availability with ${secondId}`)
                        .toBe(false);
                    expect(canBuyOutfit(first, after))
                        .withContext(`${firstId} with ${secondId} owned`)
                        .toEqual(jasmine.objectContaining(
                            { allowed: false, reason: 'availability' }));
                    // No 0x4000, so it is still on the shelf, just greyed —
                    // Bible ~:1999.
                    expect(await b.listed(EARTH, [[secondId, 1]]))
                        .withContext(`${firstId} still listed`)
                        .toContain(firstId);

                    // Selling the second generation puts it back on sale.
                    const sold = await b.context(EARTH);
                    expect(canBuyOutfit(first, sold))
                        .withContext(`${firstId} after selling ${secondId}`)
                        .toEqual({ allowed: true });
                }
            });

        it('refreshes the buyable set within one outfitter visit', async () => {
            const b = await bench(PLUGIN);
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // The Outfitter menu's own loop: a working outfit map that each
            // buy/sell mutates, with the context (and so the grid) rebuilt
            // from it afterwards. See Outfitter.applyBuy / refreshGrid.
            const owned = new Map<string, number>();
            const working = async () => b.context(EARTH, [...owned]);
            const [firstId, secondId] = PAIRS[1];  // Solar Panels
            const first = b.outfits.get(firstId)!;
            const second = b.outfits.get(secondId)!;

            expect(canBuyOutfit(first, await working())).toEqual(
                { allowed: true });
            owned.set(secondId, 1);                       // buy the 2nd gen
            expect(canBuyOutfit(first, await working()).allowed)
                .withContext('first gen immediately after buying the second')
                .toBe(false);
            owned.delete(secondId);                       // sell it back
            expect(canBuyOutfit(first, await working()))
                .withContext('first gen after selling the second back')
                .toEqual({ allowed: true });
        });
    });

    describe('Extra Outfits Tektaara Station', () => {
        const PLUGIN = 'extra-outfits';
        const TEKTAARA = 'extra-outfits:800';
        const TAM_DRONE_LASER = 'extra-outfits:524';
        const TO_DRONE_LASER = 'extra-outfits:592';
        /** The real item on the same shelf, for the contrast. */
        const PD_LASER = 'extra-outfits:460';
        const INTERFERENCE_LAUNCHER = 'extra-outfits:466';
        const INTERFERENCE_MISSILE = 'extra-outfits:467';
        /**
         * Stock control bit 29, set by stock mïsn 552 "Test EW Missile" and
         * read by stock oütf 140, the Etheric Wake Missile Launcher. The
         * Interference Missile pair rides the same unlock.
         */
        const B29 = 29;

        it('stocks exactly TechLevel 10000 (SpecialTech), nothing by level',
            async () => {
                const b = await bench(PLUGIN);
                if (!b) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                const stellar = stellarOf(
                    await b.gameData.data.Planet.get(TEKTAARA));
                expect(stellar.techLevel).toBe(-1);
                expect(stellar.specialTech).toEqual([10000]);
                expect(meetsTechLevel(10000, stellar)).toBe(true);
                expect(meetsTechLevel(9999, stellar)).toBe(false);
            });

        it('does not list the two drone lasers (BuyRandom 0)', async () => {
            const b = await bench(PLUGIN);
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            const listed = await b.listed(TEKTAARA);
            for (const id of [TAM_DRONE_LASER, TO_DRONE_LASER]) {
                const drone = b.outfits.get(id)!;
                // Everything else about them says "put me on the shelf".
                expect(drone.techLevel).withContext(id).toBe(10000);
                expect(drone.availability).withContext(id).toBe('');
                expect(drone.hideUnlessAvailable).withContext(id).toBe(false);
                expect(drone.hideUnlessRequirementsMet).withContext(id)
                    .toBe(false);
                expect(drone.excludesEqualDisplayWeight).withContext(id)
                    .toBe(false);
                expect(drone.desc.startsWith('Unused description'))
                    .withContext(id).toBe(true);
                // BuyRandom 0 is the one field that keeps them off it.
                expect(drone.buyRandom).withContext(id).toBe(0);
                expect(neverOnSale(drone)).withContext(id).toBe(true);
                expect(listed).withContext(id).not.toContain(id);
                expect(canBuyOutfit(drone, await b.context(TEKTAARA)))
                    .withContext(id).toEqual(jasmine.objectContaining(
                        { allowed: false, reason: 'notStocked' }));
            }
            // The contrast: same TechLevel, same DispWeight, same Require,
            // same blank Availability — but a real BuyRandom, so it is
            // listed (greyed, for want of the licences).
            const pd = b.outfits.get(PD_LASER)!;
            expect(pd.techLevel).toBe(10000);
            expect(pd.displayWeight)
                .toBe(b.outfits.get(TAM_DRONE_LASER)!.displayWeight);
            expect(pd.require).toBe(b.outfits.get(TAM_DRONE_LASER)!.require);
            expect(pd.buyRandom).toBe(55);
            expect(listed).toContain(PD_LASER);
        });

        it('lists the Interference Missile pair only once b29 is set',
            async () => {
                const b = await bench(PLUGIN);
                if (!b) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                const ids = [INTERFERENCE_LAUNCHER, INTERFERENCE_MISSILE];
                const without = await b.listed(TEKTAARA);
                const with29 = await b.listed(TEKTAARA, [], [B29]);
                for (const id of ids) {
                    const outfit = b.outfits.get(id)!;
                    expect(outfit.techLevel).withContext(id).toBe(10000);
                    expect(outfit.availability).withContext(id).toBe('b29');
                    // 0x4000: hidden outright until Availability is true,
                    // which is why they are absent rather than greyed.
                    expect(outfit.hideUnlessAvailable).withContext(id)
                        .toBe(true);
                    expect(outfit.buyRandom).withContext(id)
                        .toBeGreaterThan(0);
                    expect(without).withContext(id).not.toContain(id);
                    expect(with29).withContext(id).toContain(id);
                    // Still gated on the Missile Weapons License, which a
                    // bare Terrapin does not carry.
                    expect(requirementsMet(outfit,
                        await b.context(TEKTAARA, [], [B29])))
                        .withContext(id).toBe(false);
                }
            });
    });

    describe('More Blasters Hyperioid cell samples', () => {
        const PLUGIN = 'More Blasters CHEAT';
        const SAMPLE = 'More Blasters CHEAT:520';
        const SPACE_CRANE = 'More Blasters CHEAT:526';
        /** TechLevel 7, and no SpecialTech 115. */
        const EARTH = 'nova:128';
        /** TechLevel 5, SpecialTech 55,56,57,81,111,112,115,116. */
        const RAUTHER = 'nova:191';

        it('is not listed at a world that does not stock TechLevel 115, '
            + 'however many Space Cranes are aboard', async () => {
                const b = await bench(PLUGIN);
                if (!b) {
                    pending('More Blasters CHEAT plug-in not installed');
                    return;
                }
                const sample = b.outfits.get(SAMPLE)!;
                const crane = b.outfits.get(SPACE_CRANE)!;
                // The samples are the crane weapon's ammunition — that is
                // how they are plundered — and owning the launcher must not
                // put them on a shelf that does not stock them.
                expect(sample.ammoFor).toBe('More Blasters CHEAT:248');
                expect(crane.weapons).toEqual({ 'More Blasters CHEAT:248': 1 });
                expect(sample.techLevel).toBe(115);
                expect(await b.listed(EARTH, [[SPACE_CRANE, 1]]))
                    .not.toContain(SAMPLE);
                expect(canBuyOutfit(sample,
                    await b.context(EARTH, [[SPACE_CRANE, 1]])))
                    .toEqual(jasmine.objectContaining(
                        { allowed: false, reason: 'notStocked' }));
            });

        it('is on sale at a SpecialTech 115 world because the CHEAT variant '
            + 'unlocked it', async () => {
                const b = await bench(PLUGIN);
                if (!b) {
                    pending('More Blasters CHEAT plug-in not installed');
                    return;
                }
                const sample = b.outfits.get(SAMPLE)!;
                // The shipped non-cheat "More Blasters.rez" gates the same
                // oütf 520 twice: Availability `O525` (oütf 525 is called
                // "Unobtainable outfit" and is itself BuyRandom 0, so it can
                // never be had) AND BuyRandom 0. The CHEAT variant cleared
                // BOTH — Availability "" and BuyRandom 100 — and changed
                // nothing else about it. So being able to buy them here is
                // the cheat working as designed, not a NovaJS bug.
                expect(sample.availability).toBe('');
                expect(sample.buyRandom).toBe(100);
                expect(neverOnSale(sample)).toBe(false);
                expect(await b.listed(RAUTHER)).toContain(SAMPLE);
                expect(canBuyOutfit(sample, await b.context(RAUTHER)))
                    .toEqual({ allowed: true });
            });

        it('sells plundered samples anywhere (0x0800), tech level aside',
            async () => {
                const b = await bench(PLUGIN);
                if (!b) {
                    pending('More Blasters CHEAT plug-in not installed');
                    return;
                }
                const sample = b.outfits.get(SAMPLE)!;
                expect(sample.sellAnywhere).toBe(true);
                const holding = await b.context(EARTH, [[SAMPLE, 4]]);
                expect(await b.listed(EARTH, [[SAMPLE, 4]])).toContain(SAMPLE);
                expect(canSellOutfit(sample, holding))
                    .toEqual({ allowed: true });
                expect(canBuyOutfit(sample, holding))
                    .toEqual(jasmine.objectContaining(
                        { allowed: false, reason: 'notStocked' }));
            });
    });
});
