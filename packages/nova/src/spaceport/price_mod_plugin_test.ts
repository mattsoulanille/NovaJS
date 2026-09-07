import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { RankData } from 'novadatainterface/rank_data';
import { ShipData } from 'novadatainterface/ship_data';
import { GameDataAggregator }
    from '../server/parsing/game_data_aggregator.js';
import { getPluginGameData } from '../communication/simulation_test_fixture.js';
import { makeControlBitHooks, runNCBSet, rankPriceMod } from '../nova_plugin/ncb/index.js';
import { hirePrice } from './hire_escort.js';
import { outfitPrice, outfitResaleValue } from './outfitter_rules.js';
import { modifiedPrice } from './price_mod.js';
import { shipListPrice, ShipPurchaseContext } from './shipyard_rules.js';

/**
 * ============================================================================
 * Extra Outfits' Spica Shipyard: the ships are free, the materials are not
 * ============================================================================
 *
 * The plug-in's biggest NCB/crön feature, and the case Matthew ruled on after
 * playtesting it: "while ships should be free, building materials and outfits
 * should NOT be."
 *
 * The player buys oütf extra-outfits:552 "Buy Station" for 10,000,000 cr; its
 * OnPurchase is
 *
 *     b20001 N800 K167 K168 K169 K170 K171
 *
 * (b20001 is how NovaParse renumbered the plug-in's own b2000 — see
 * nova_plugin/ncb/control_bit_namespaces.ts). That bit swaps the empty shell
 * spöb extra-outfits:801 for the built station spöb extra-outfits:802, which
 * is gövt extra-outfits:302 "SSC" / "Spica Shipyard Corp." and carries
 * SpecialTech 10002/10003/10006 — the tech levels of the hulls the station
 * constructs (shïp extra-outfits:801-815 at 10003 and 820 at 10006).
 *
 * Of the five ranks that purchase grants, extra-outfits:167 is the running
 * cost ("Shipyard Expenses (1000 per day)", Salary -1000, no AffilGovt) and
 * 168-171 are the price mechanism: four otherwise EMPTY ränk resources — no
 * name, no ConvName, no salary, no flags, Weight 1 — whose only content is
 * AffilGovt extra-outfits:302 and PriceMod 1.
 *
 * Four compounding 1% modifiers is 1e-6 percent, which floors every hull in
 * the plug-in (up to the 12,000,000 cr Leviathan) to 0 cr and every hire fee
 * with it. See rank_logic.ts's rankPriceMod for why compounding is the reading
 * the data forces.
 *
 * WHY THE OUTFITTER IS EXEMPT. The station's shop (SpecialTech 10003) sells
 * two kinds of thing. The BUILD ORDERS are already 0 cr in the resource —
 * oütf 562 "Build Cargo Drone", 564 "Build Shuttle", 590 "Build Leviathan",
 * 638 "Build Corvette" and the rest. What they cost is MATERIALS, consumed by
 * their set strings: "Build Leviathan" is OnPurchase `D561`, eating one oütf
 * 561 "Building Materials °10000 tons°" at 7,000,000 cr, and yielding a hull
 * (shïp extra-outfits:815) worth 12,000,000. "Build Corvette" is `D637 D558
 * D557` — 2,250,000 + 200,000 + 100,000 = 2,550,000 cr of materials for a
 * 2,750,000 cr hull.
 *
 * So the four ranks exist to zero the SHIPYARD, and only the shipyard: the
 * hull Costs have to stay real (that is what the built ship later SELLS for,
 * and what the bar's hire fee is 10% of), and PriceMod at the owning govt is
 * the only lever in the engine that makes the same hull free to its builder.
 * The author needed no such lever for the free items — those are literally
 * 0 cr. Discounting the outfitter as well would hand over every materials
 * tier for nothing, turn a tuned 200,000 cr margin into an unbounded credit
 * press, and make every price typed into oütf 554-561 and 637 dead data.
 */
describe('Extra Outfits\' Spica Shipyard prices', () => {
    const EXTRA = 'extra-outfits';
    /** The station the b2000 override swaps in, gövt extra-outfits:302. */
    const BUILT_STATION = `${EXTRA}:802`;
    /** The empty shell shown before the station is bought. */
    const SHELL = `${EXTRA}:801`;
    /** oütf "Buy Station", 10,000,000 cr. */
    const BUY_STATION = `${EXTRA}:552`;
    /** The hulls the station builds: 801-815 (tech 10003), 820 (10006). */
    const BUILT_SHIPS = [
        ...Array.from({ length: 15 }, (_, i) => `${EXTRA}:${801 + i}`),
        `${EXTRA}:820`,
    ];
    /** The four empty PriceMod-1 ranks, and the expenses rank with them. */
    const PRICE_RANKS = [168, 169, 170, 171].map(n => `${EXTRA}:${n}`);
    const EXPENSES_RANK = `${EXTRA}:167`;
    /**
     * The raw materials the station's outfitter sells, priced by the ton.
     * These are the "building materials" of Matthew's ruling: every one of
     * them would floor to 0 if the four PriceMod-1 ranks reached this shop.
     */
    const MATERIALS: [number, string, number][] = [
        [554, 'Building Materials °5 tons°', 2_500],
        [555, 'Building Materials °10 tons°', 7_500],
        [556, 'Building Materials °20 tons°', 15_000],
        [557, 'Building Materials °50 tons°', 100_000],
        [558, 'Building Materials °100 tons°', 200_000],
        [559, 'Building Materials °500 tons°', 300_000],
        [560, 'Building Materials °2000 tons°', 1_200_000],
        [561, 'Building Materials °10000 tons°', 7_000_000],
        [637, 'Exotic Building Materials', 2_250_000],
        [553, 'Building Crew', 27_000],
    ];

    interface Bench {
        gameData: GameDataAggregator;
        station: PlanetData;
        shell: PlanetData;
        buyStation: OutfitData;
        ships: ShipData[];
        getRank(id: string): RankData | undefined;
    }

    let bench: Bench | undefined;
    beforeAll(async () => {
        const gameData = await getPluginGameData([EXTRA]);
        if (!gameData) {
            return;
        }
        const ranks = new Map<string, RankData>();
        for (const id of (await gameData.ids).Rank) {
            ranks.set(id, await gameData.data.Rank.get(id));
        }
        bench = {
            gameData,
            station: await gameData.data.Planet.get(BUILT_STATION),
            shell: await gameData.data.Planet.get(SHELL),
            buyStation: await gameData.data.Outfit.get(BUY_STATION),
            ships: await Promise.all(
                BUILT_SHIPS.map(id => gameData.data.Ship.get(id))),
            getRank: id => ranks.get(id),
        };
    }, 240_000);

    /** The active rank set the "Buy Station" purchase actually produces. */
    function ranksAfterBuyingTheStation(b: Bench): Set<string> {
        const active = new Set<string>();
        const bits = new Set<number>();
        runNCBSet(b.buyStation.onPurchase,
            makeControlBitHooks(bits, undefined, {
                active,
                resolveId: id => `${EXTRA}:${id}`,
                getRank: b.getRank,
            }),
            // The set string has no random operator; nothing draws from this.
            () => 0);
        return active;
    }

    function purchaseContext(ship: ShipData, priceMod?: number):
        ShipPurchaseContext {
        return {
            // Flying the same hull, so the trade-in is a fixed 25% of it and
            // cannot be mistaken for the discount.
            currentShip: ship,
            outfits: new Map(),
            getOutfit: () => undefined,
            credits: 100_000_000,
            priceMod,
        };
    }

    it('pins the station, its govt, and the four empty PriceMod-1 ranks',
        () => {
            if (!bench) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            expect(bench.shell.name).toBe('Spica Shipyard');
            // The pre-purchase shell has no owner, so no rank discounts it.
            expect(bench.shell.govt).toBeNull();
            expect(bench.shell.flags.hasShipyard).toBeFalse();

            expect(bench.station.name).toBe('Spica Shipyard');
            expect(bench.station.govt).toBe(`${EXTRA}:302`);
            expect(bench.station.techLevel).toBe(-1);
            expect(bench.station.specialTech)
                .toEqual([10002, 10003, 10006]);
            expect(bench.station.flags.hasShipyard).toBeTrue();
            expect(bench.station.flags.hasOutfitter).toBeTrue();

            expect(bench.buyStation.name).toBe('Buy Station');
            expect(bench.buyStation.price).toBe(10_000_000);
            expect(bench.buyStation.onPurchase)
                .toBe('b20001 N800 K167 K168 K169 K170 K171');

            const expenses = bench.getRank(EXPENSES_RANK)!;
            expect(expenses.name).toBe('Shipyard Expenses (1000 per day)');
            expect(expenses.salary).toBe(-1000);
            // No AffilGovt, so it is a pure running cost and prices nothing.
            expect(expenses.affilGovt).toBeNull();

            for (const id of PRICE_RANKS) {
                const rank = bench.getRank(id)!;
                expect(rank.name).toBe('');
                expect(rank.convName).toBe('');
                expect(rank.affilGovt).toBe(`${EXTRA}:302`);
                expect(rank.priceMod).toBe(1);
                expect(rank.salary).toBe(0);
                expect(rank.flags).toBe(0);
                expect(rank.weight).toBe(1);
            }
        });

    it('grants all five ranks when the station is bought', () => {
        if (!bench) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        expect([...ranksAfterBuyingTheStation(bench)].sort())
            .toEqual([EXPENSES_RANK, ...PRICE_RANKS].sort());
    });

    it('compounds the granted ranks to a free shipyard and a zero hire fee '
        + 'at the station', () => {
            if (!bench) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            const active = ranksAfterBuyingTheStation(bench);
            const mod = rankPriceMod(active, bench.getRank,
                bench.station.govt);
            expect(mod).toBeCloseTo(1e-6, 12);

            for (const ship of bench.ships) {
                expect(ship.price).toBeGreaterThan(0);
                // The asking price, the amount charged and the hire fee.
                expect(shipListPrice(ship, purchaseContext(ship, mod)))
                    .withContext(`${ship.id} ${ship.name}`).toBe(0);
                expect(hirePrice(ship, mod))
                    .withContext(`${ship.id} ${ship.name}`).toBe(0);
            }
        });

    it('still charges full price for the BUILDING MATERIALS the free hulls '
        + 'are made of', async () => {
            if (!bench) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // The ranks are active and the shipyard is free (above); the
            // shop is unmoved. Matthew's ruling, and the only reading under
            // which the plug-in's economy loop exists at all.
            for (const [id, name, price] of MATERIALS) {
                const outfit = await bench.gameData.data.Outfit
                    .get(`${EXTRA}:${id}`);
                expect(outfit.name).withContext(`${id}`).toBe(name);
                expect(outfit.price).withContext(name).toBe(price);
                expect(outfitPrice(outfit)).withContext(name).toBe(price);
                // Sell-back stays the plain 50%, so buying and immediately
                // reselling still loses half — nothing mints credits.
                expect(outfitResaleValue(outfit)).withContext(name)
                    .toBe(Math.floor(price / 2));
                expect(outfitResaleValue(outfit))
                    .toBeLessThanOrEqual(outfitPrice(outfit));
            }

            // The build orders, by contrast, are free in the DATA — the
            // author never needed a PriceMod for them. "Build Leviathan"
            // eats one 7,000,000 cr materials package (D561) and yields the
            // 12,000,000 cr hull the shipyard hands over for nothing.
            const buildLeviathan = await bench.gameData.data.Outfit
                .get(`${EXTRA}:590`);
            expect(buildLeviathan.name).toBe('Build Leviathan');
            expect(buildLeviathan.price).toBe(0);
            expect(buildLeviathan.onPurchase).toBe('D561');
            expect(outfitPrice(buildLeviathan)).toBe(0);
            const leviathan = bench.ships.find(s => s.name === 'Leviathan')!;
            expect(leviathan.price).toBe(12_000_000);

            // And the station outfit itself still quotes its own 10M price
            // while standing in the shop it bought.
            expect(outfitPrice(bench.buyStation)).toBe(10_000_000);
        });

    it('leaves the same ships at full price without the ranks', () => {
        if (!bench) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        for (const ship of bench.ships) {
            expect(shipListPrice(ship, purchaseContext(ship)))
                .toBe(ship.price);
            expect(hirePrice(ship)).toBe(Math.round(ship.price / 10));
            // Explicitly: no rank active means PriceMod 100.
            const none = rankPriceMod(new Set(), bench.getRank,
                bench.station.govt);
            expect(none).toBe(100);
            expect(modifiedPrice(ship.price, none)).toBe(ship.price);
        }
        // The dearest hull the station builds, for the record: hiring its
        // pilot anywhere else costs 1,200,000 cr.
        const leviathan = bench.ships.find(s => s.name === 'Leviathan')!;
        expect(leviathan.price).toBe(12_000_000);
        expect(hirePrice(leviathan)).toBe(1_200_000);
    });

    it('does not discount anyone else\'s worlds', () => {
        if (!bench) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        const active = ranksAfterBuyingTheStation(bench);
        // The unbuilt shell has no govt at all, and a stock Federation
        // world belongs to someone else.
        expect(rankPriceMod(active, bench.getRank, bench.shell.govt))
            .toBe(100);
        expect(rankPriceMod(active, bench.getRank, 'nova:128')).toBe(100);
    });
});
