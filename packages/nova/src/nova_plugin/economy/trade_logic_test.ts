import 'jasmine';
import { getDefaultJunkData, JunkData } from 'novadatainterface/junk_data';
import { getDefaultPlanetData, PlanetData, TradeTier } from 'novadatainterface/planet_data';
import {
    buyGood,
    buyGoodQuantity,
    freeCargoSpace,
    EXCHANGE_JUNK_ROWS,
    junkExchangeRows,
    junkTradeGoods,
    maxBuyQuantity,
    maxSellQuantity,
    otherCargoNames,
    sellGood,
    sellGoodQuantity,
    standardTradeGoods,
    stellarHasTradeCenter,
    stellarNeedsJunksForTrade,
    STANDARD_COMMODITY_BASE_PRICES,
    tierPrice,
    TradeGood,
    TradeWorkingState,
} from './trade_logic.js';

function makePlanet(tradeTiers: (TradeTier | null)[],
    rest: Partial<PlanetData> = {}): PlanetData {
    return { ...getDefaultPlanetData(), tradeTiers, ...rest };
}

function makeJunk(junk: Partial<JunkData>): JunkData {
    return { ...getDefaultJunkData(), ...junk };
}

function makeState({ cargo = [], credits = 10_000, capacity = 50 }: {
    cargo?: [string, number][],
    credits?: number,
    capacity?: number,
} = {}): TradeWorkingState {
    return {
        cargo: new Map(cargo),
        credits: { credits },
        cargoCapacity: capacity,
    };
}

const good = (overrides: Partial<TradeGood> = {}): TradeGood => ({
    key: 'cargo:0',
    name: 'Food',
    tier: 'med',
    price: 75,
    canBuy: true,
    canSell: true,
    ...overrides,
});

describe('tierPrice', () => {
    it('applies the Bible tier percentages to the base price', () => {
        // Medical (base 750): the trade_center screenshot's Low 600.
        expect(tierPrice(750, 'low')).toEqual(600);
        // Food (base 75): the screenshot's Med 75.
        expect(tierPrice(75, 'med')).toEqual(75);
        // Luxury goods (base 900): the screenshot's High 1125.
        expect(tierPrice(900, 'high')).toEqual(1125);
    });

    it('truncates fractional tier prices like the original', () => {
        // Medical Supplies (base 750): 390_medical_supplies.png shows
        // High 937, not the rounded 938 (750 x 1.25 = 937.5).
        expect(tierPrice(750, 'high')).toEqual(937);
        expect(tierPrice(751, 'low')).toEqual(600);
    });
});

describe('the original\'s Kit Port exchange (reference #321)', () => {
    // docs/reference_experiments.md, #321: six pilots differing only in
    // their priceFlux globals all showed exactly these prices (and so did
    // days 2-3). Tiers are x0.8 / x1 / x1.25 of base, truncated.
    it('prices every standard commodity exactly as the original', () => {
        const kitPort = makePlanet(['low', 'med', 'high', 'low', 'med',
            'high']);
        expect(standardTradeGoods(kitPort).map(g => [g.tier, g.price]))
            .toEqual([
                ['low', 60], // Food
                ['med', 350], // Industrial
                ['high', 937], // Medical
                ['low', 720], // Luxury
                ['med', 200], // Metal
                ['high', 687], // Equipment
            ]);
    });

    it('shows a jünk High where it is bought and Low where it is sold', () => {
        const gadgets = makeJunk({
            id: 'kit:128', name: 'Kit Gadgets', basePrice: 150,
            boughtAt: ['kit:port'], soldAt: [],
        });
        const widgets = makeJunk({
            id: 'kit:129', name: 'Kit Widgets', basePrice: 1000,
            soldAt: ['kit:port'], boughtAt: [],
        });
        expect(junkTradeGoods(gadgets, 'kit:port', new Set()))
            .toEqual([jasmine.objectContaining({ tier: 'high', price: 187 })]);
        expect(junkTradeGoods(widgets, 'kit:port', new Set()))
            .toEqual([jasmine.objectContaining({ tier: 'low', price: 800 })]);
    });
});

describe('the original\'s jünk rows and the 8-row exchange (#321 wave 10)', () => {
    // docs/reference_experiments.md, "#321 wave 10": the kit's jünk at Kit
    // Port and Kit Market, ids as in the kit (200 / 201 / 202).
    const widgets = makeJunk({
        id: 'kit:200', name: 'Kit Widgets', basePrice: 1000,
        soldAt: ['kit:port'], boughtAt: ['kit:market'],
    });
    const gadgets = makeJunk({
        id: 'kit:201', name: 'Kit Gadgets', basePrice: 150,
        soldAt: ['kit:market'], boughtAt: ['kit:port'],
    });
    const doodads = makeJunk({
        id: 'kit:202', name: 'Kit Doodads', basePrice: 400,
        soldAt: ['kit:port'], boughtAt: ['kit:port'],
    });
    const rows = (junks: JunkData[], planet: string) =>
        junkExchangeRows(junks, planet, new Set())
            .map(row => [row.name, row.tier, row.price, row.canBuy,
                row.canSell]);

    it('shows a stellar in BOTH lists two rows: High (sell) then Low (buy)',
        () => {
            expect(junkTradeGoods(doodads, 'kit:port', new Set())
                .map(row => [row.key, row.tier, row.price, row.canBuy,
                    row.canSell]))
                .toEqual([
                    ['junk:kit:202', 'high', 500, false, true],
                    ['junk:kit:202', 'low', 320, true, false],
                ]);
        });

    it('gates the High row on BuyOn and the Low row on SellOn', () => {
        // Reference wave 12: the stellar is the one buying (BoughtAt,
        // the High row) or selling (SoldAt, the Low row).
        const buyGated = makeJunk({ ...doodads, buyOn: 'b7' });
        expect(junkTradeGoods(buyGated, 'kit:port', new Set())
            .map(row => row.tier)).toEqual(['low']);
        expect(junkTradeGoods(buyGated, 'kit:port', new Set([7]))
            .map(row => row.tier)).toEqual(['high', 'low']);
        const sellGated = makeJunk({ ...doodads, sellOn: 'b7' });
        expect(junkTradeGoods(sellGated, 'kit:port', new Set())
            .map(row => row.tier)).toEqual(['high']);
        expect(junkTradeGoods(sellGated, 'kit:port', new Set([7]))
            .map(row => row.tier)).toEqual(['high', 'low']);
    });

    it('lists two jünk slots below the six standard ones', () => {
        expect(EXCHANGE_JUNK_ROWS).toBe(2);
    });

    it('keeps Kit Port\'s Doodads rows and drops Widgets and Gadgets', () => {
        // The original's wave-10 Kit Port table: the six standard goods,
        // then Kit Doodads High 500 and Kit Doodads Low 320, and nothing
        // else, whatever order the jünks load in.
        const expected = [
            ['Kit Doodads', 'high', 500, false, true],
            ['Kit Doodads', 'low', 320, true, false],
        ];
        expect(rows([widgets, gadgets, doodads], 'kit:port'))
            .toEqual(expected);
        expect(rows([doodads, widgets, gadgets], 'kit:port'))
            .toEqual(expected);
    });

    it('lists High rows above Low rows, whatever the ids', () => {
        // Wave 1's Kit Port (before Doodads): Gadgets High above Widgets
        // Low; wave 10's Kit Market: Widgets High above Gadgets Low.
        expect(rows([widgets, gadgets], 'kit:port')).toEqual([
            ['Kit Gadgets', 'high', 187, false, true],
            ['Kit Widgets', 'low', 800, true, false],
        ]);
        expect(rows([widgets, gadgets, doodads], 'kit:market')).toEqual([
            ['Kit Widgets', 'high', 1250, false, true],
            ['Kit Gadgets', 'low', 120, true, false],
        ]);
    });

    it('is empty where no jünk trades', () => {
        expect(rows([widgets, gadgets, doodads], 'kit:elsewhere'))
            .toEqual([]);
    });

    it('gives a tier\'s slot to the next jünk when the highest is gated',
        () => {
            // Doodads (202) gated out of the High slot: Gadgets (201)
            // takes it, and Doodads keeps the Low one.
            const gatedDoodads = makeJunk({ ...doodads, buyOn: 'b9' });
            expect(rows([widgets, gadgets, gatedDoodads], 'kit:port'))
                .toEqual([
                    ['Kit Gadgets', 'high', 187, false, true],
                    ['Kit Doodads', 'low', 320, true, false],
                ]);
        });
});

describe('the original\'s Schmoo exchange (reference wave 12)', () => {
    // docs/reference_experiments.md, "Trade center at Schmoo, and the
    // trade-in's outfits, wave 12": stock spöb 322 is in the BoughtAt list
    // of jünk 145 Seafood Delicacies, 146 Opals and 149 Durknen Girns
    // (whose BuyOn is b43) and the SoldAt list of none. Base prices are
    // the stock data's (550 / 1,200 / 3,000).
    const seafood = makeJunk({
        id: 'nova:145', name: 'Seafood Delicacies', basePrice: 550,
        boughtAt: ['nova:322'],
    });
    const opals = makeJunk({
        id: 'nova:146', name: 'Opals', basePrice: 1200,
        boughtAt: ['nova:322'],
    });
    const girns = makeJunk({
        id: 'nova:149', name: 'Durknen Girns', basePrice: 3000,
        boughtAt: ['nova:322'], buyOn: 'b43',
    });
    const rows = (bits: number[]) =>
        junkExchangeRows([seafood, opals, girns], 'nova:322', new Set(bits))
            .map(row => [row.name, row.tier, row.price]);

    it('shows Opals (High 1500) alone with bit 43 clear', () => {
        expect(rows([])).toEqual([['Opals', 'high', 1500]]);
    });

    it('shows Durknen Girns (High 3750) alone once bit 43 is set', () => {
        expect(rows([43])).toEqual([['Durknen Girns', 'high', 3750]]);
    });
});

describe('standardTradeGoods', () => {
    it('lists only commodities the stellar trades in, in STR# order', () => {
        // Earth: Food med, Industrial med, Medical low, Luxury high,
        // Metal med, no Equipment.
        const planet = makePlanet(['med', 'med', 'low', 'high', 'med', null]);
        const goods = standardTradeGoods(planet);
        expect(goods.map(g => g.key)).toEqual(
            ['cargo:0', 'cargo:1', 'cargo:2', 'cargo:3', 'cargo:4']);
        expect(goods.map(g => g.price)).toEqual([75, 350, 600, 1125, 200]);
        expect(goods.every(g => g.canBuy && g.canSell)).toBeTrue();
    });

    it('is empty for a stellar with no exchange tiers', () => {
        expect(standardTradeGoods(makePlanet(
            [null, null, null, null, null, null]))).toEqual([]);
    });

    it('uses the scenario cargo names (STR# 4000) when supplied', () => {
        const planet = makePlanet(['med', 'med', null, null, null, null]);
        const goods = standardTradeGoods(planet,
            ['Grain', 'Machinery', 'Medicine']);
        expect(goods.map(g => g.name)).toEqual(['Grain', 'Machinery']);
        // A gap in the supplied list falls back to the built-in name.
        const partial = standardTradeGoods(
            makePlanet(['med', null, null, null, null, 'med']), ['Grain']);
        expect(partial.map(g => g.name)).toEqual(['Grain', 'Equipment']);
    });
});

describe('junkTradeGoods', () => {
    const junk = makeJunk({
        id: 'nova:128',
        name: 'Duranium Alloy',
        basePrice: 900,
        soldAt: ['nova:200'],
        boughtAt: ['nova:300'],
    });

    it('buys at the low tier where the jünk is sold', () => {
        const [row, ...rest] = junkTradeGoods(junk, 'nova:200', new Set());
        expect(rest).toEqual([]);
        expect(row).toEqual(jasmine.objectContaining({
            key: 'junk:nova:128',
            tier: 'low',
            price: 720,
            canBuy: true,
            canSell: false,
        }));
    });

    it('sells at the high tier where the jünk is bought', () => {
        const [row, ...rest] = junkTradeGoods(junk, 'nova:300', new Set());
        expect(rest).toEqual([]);
        expect(row).toEqual(jasmine.objectContaining({
            tier: 'high',
            price: 1125,
            canBuy: false,
            canSell: true,
        }));
    });

    it('is null where the jünk does not trade', () => {
        expect(junkTradeGoods(junk, 'nova:400', new Set())).toEqual([]);
    });

    it('gates the player\'s buying (a SoldAt row) on SellOn', () => {
        const gated = makeJunk({ ...junk, sellOn: 'b3' });
        expect(junkTradeGoods(gated, 'nova:200', new Set())).toEqual([]);
        expect(junkTradeGoods(gated, 'nova:200', new Set([3]))[0]?.canBuy)
            .toBeTrue();
        // BuyOn does not gate it.
        const other = makeJunk({ ...junk, buyOn: 'b3' });
        expect(junkTradeGoods(other, 'nova:200', new Set())[0]?.canBuy)
            .toBeTrue();
    });

    it('gates the player\'s selling (a BoughtAt row) on BuyOn', () => {
        const gated = makeJunk({ ...junk, buyOn: 'b3' });
        expect(junkTradeGoods(gated, 'nova:300', new Set())).toEqual([]);
        expect(junkTradeGoods(gated, 'nova:300', new Set([3]))[0]?.canSell)
            .toBeTrue();
    });

    it('fails closed on a malformed NCB test', () => {
        const bad = makeJunk({ ...junk, buyOn: '((((' });
        expect(junkTradeGoods(bad, 'nova:300', new Set())).toEqual([]);
    });
});

describe('buyGood', () => {
    it('buys as many tons as fit and are affordable', () => {
        const state = makeState({ credits: 1000, capacity: 50 });
        // 1000 cr at 75/ton affords 13; space allows 50.
        expect(buyGood(state, good())).toEqual(13);
        expect(state.cargo.get('cargo:0')).toEqual(13);
        expect(state.credits.credits).toEqual(1000 - 13 * 75);
    });

    it('is limited by free cargo space including mission cargo', () => {
        const state = makeState({
            credits: 100_000, capacity: 50,
            cargo: [['mission:nova:128', 45]],
        });
        expect(buyGood(state, good())).toEqual(5);
        expect(freeCargoSpace(state)).toEqual(0);
    });

    it('buys nothing when broke or full', () => {
        expect(buyGood(makeState({ credits: 74 }), good())).toEqual(0);
        const full = makeState({ cargo: [['cargo:1', 50]], capacity: 50 });
        expect(buyGood(full, good())).toEqual(0);
        expect(full.credits.credits).toEqual(10_000);
    });

    it('never buys goods flagged unbuyable here', () => {
        const state = makeState();
        expect(buyGood(state, good({ canBuy: false }))).toEqual(0);
        expect(state.cargo.size).toEqual(0);
    });
});

describe('sellGood', () => {
    it('sells the whole held quantity at the row price', () => {
        const state = makeState({ cargo: [['cargo:0', 7]], credits: 0 });
        expect(sellGood(state, good())).toEqual(7);
        expect(state.cargo.has('cargo:0')).toBeFalse();
        expect(state.credits.credits).toEqual(7 * 75);
    });

    it('sells nothing when none is held or selling is barred', () => {
        expect(sellGood(makeState(), good())).toEqual(0);
        const state = makeState({ cargo: [['cargo:0', 7]] });
        expect(sellGood(state, good({ canSell: false }))).toEqual(0);
        expect(state.cargo.get('cargo:0')).toEqual(7);
    });

    it('never touches mission cargo (its key is never a trade row)', () => {
        const state = makeState({ cargo: [['mission:nova:128', 7]] });
        expect(sellGood(state, good())).toEqual(0);
        expect(state.cargo.get('mission:nova:128')).toEqual(7);
    });
});

describe('maxBuyQuantity', () => {
    it('is the lesser of what fits and what is affordable', () => {
        // 1000 cr at 75/ton affords 13; 50 tons fit.
        expect(maxBuyQuantity(makeState({ credits: 1000 }), good()))
            .toEqual(13);
        // 100,000 cr affords plenty; only 50 tons fit.
        expect(maxBuyQuantity(makeState({ credits: 100_000 }), good()))
            .toEqual(50);
    });

    it('is zero for unbuyable goods or a broke player', () => {
        expect(maxBuyQuantity(makeState(), good({ canBuy: false })))
            .toEqual(0);
        expect(maxBuyQuantity(makeState({ credits: 74 }), good()))
            .toEqual(0);
    });
});

describe('maxSellQuantity', () => {
    it('is the held tonnage of a sellable good', () => {
        const state = makeState({ cargo: [['cargo:0', 8]] });
        expect(maxSellQuantity(state, good())).toEqual(8);
        expect(maxSellQuantity(state, good({ canSell: false }))).toEqual(0);
        expect(maxSellQuantity(makeState(), good())).toEqual(0);
    });
});

describe('buyGoodQuantity', () => {
    it('buys the requested tonnage when the limits allow it', () => {
        const state = makeState({ credits: 1000, capacity: 50 });
        expect(buyGoodQuantity(state, good(), 5)).toEqual(5);
        expect(state.cargo.get('cargo:0')).toEqual(5);
        expect(state.credits.credits).toEqual(1000 - 5 * 75);
    });

    it('clamps an over-entered quantity to the most allowed', () => {
        const state = makeState({ credits: 1000, capacity: 50 });
        // 999 requested; 13 affordable.
        expect(buyGoodQuantity(state, good(), 999)).toEqual(13);
        expect(state.credits.credits).toEqual(1000 - 13 * 75);

        const cramped = makeState({ credits: 100_000, capacity: 10 });
        expect(buyGoodQuantity(cramped, good(), 999)).toEqual(10);
    });

    it('buys nothing for zero, unbuyable, or broke requests', () => {
        const state = makeState({ credits: 1000 });
        expect(buyGoodQuantity(state, good(), 0)).toEqual(0);
        expect(buyGoodQuantity(state, good({ canBuy: false }), 5)).toEqual(0);
        expect(buyGoodQuantity(makeState({ credits: 0 }), good(), 5))
            .toEqual(0);
        expect(state.cargo.size).toEqual(0);
    });
});

describe('sellGoodQuantity', () => {
    it('sells the requested tonnage, leaving the rest aboard', () => {
        const state = makeState({ cargo: [['cargo:0', 8]], credits: 0 });
        expect(sellGoodQuantity(state, good(), 3)).toEqual(3);
        expect(state.cargo.get('cargo:0')).toEqual(5);
        expect(state.credits.credits).toEqual(3 * 75);
    });

    it('clamps an over-entered quantity to the held amount', () => {
        const state = makeState({ cargo: [['cargo:0', 8]], credits: 0 });
        expect(sellGoodQuantity(state, good(), 999)).toEqual(8);
        expect(state.cargo.has('cargo:0')).toBeFalse();
        expect(state.credits.credits).toEqual(8 * 75);
    });

    it('sells nothing when barred or nothing is held', () => {
        const state = makeState({ cargo: [['cargo:0', 8]] });
        expect(sellGoodQuantity(state, good({ canSell: false }), 3))
            .toEqual(0);
        expect(sellGoodQuantity(makeState(), good(), 3)).toEqual(0);
        expect(state.cargo.get('cargo:0')).toEqual(8);
    });
});

describe('otherCargoNames', () => {
    it('reports mission cargo and non-tradeable junk', () => {
        const cargo = new Map([
            ['cargo:0', 5],
            ['mission:nova:128', 3],
            ['mission:nova:129', 2],
            ['junk:nova:130', 1],
        ]);
        expect(otherCargoNames(cargo, [good()])).toEqual(
            ['5 tons of mission cargo', 'junk:nova:130']);
    });
});

describe('STANDARD_COMMODITY_BASE_PRICES', () => {
    it('matches the stock STR# 4004 base prices', () => {
        expect(STANDARD_COMMODITY_BASE_PRICES)
            .toEqual([75, 350, 750, 900, 200, 550]);
    });
});

describe('stellarHasTradeCenter (reference "Spaceport venue buttons (K6, '
    + '#373), wave 36", finding 2)', () => {
    const flagged = (tiers: (TradeTier | null)[]) => makePlanet(tiers, {
        id: 'nova:300',
        flags: { ...getDefaultPlanetData().flags, canLand: true,
            hasCommodityExchange: true, hasBar: true },
    });
    const none = [null, null, null, null, null, null];

    it('needs a commodity price tier as well as flag 0x02: the 0x43 ports '
        + 'with every tier zero had no Trade Center', () => {
        expect(stellarHasTradeCenter(flagged(none))).toBeFalse();
        expect(stellarNeedsJunksForTrade(flagged(none))).toBeTrue();
    });

    it('opens on any one tier (GUESS: only none and several were seen)',
        () => {
            for (const tier of ['low', 'med', 'high'] as const) {
                for (let i = 0; i < 6; i++) {
                    const tiers: (TradeTier | null)[] = [...none];
                    tiers[i] = tier;
                    expect(stellarHasTradeCenter(flagged(tiers)))
                        .withContext(`${tier} ${i}`).toBeTrue();
                    expect(stellarNeedsJunksForTrade(flagged(tiers)))
                        .toBeFalse();
                }
            }
        });

    it('opens on a jünk the stellar buys or sells (GUESS)', () => {
        const other = makeJunk({ id: 'nova:128', soldAt: ['nova:301'] });
        expect(stellarHasTradeCenter(flagged(none), [other])).toBeFalse();
        expect(stellarHasTradeCenter(flagged(none), [other,
            makeJunk({ id: 'nova:129', soldAt: ['nova:300'] })])).toBeTrue();
        expect(stellarHasTradeCenter(flagged(none), [
            makeJunk({ id: 'nova:129', boughtAt: ['nova:300'] })])).toBeTrue();
    });

    it('never opens without flag 0x02, whatever it trades', () => {
        const unflagged = makePlanet(['low', null, null, null, null, null],
            { id: 'nova:300' });
        expect(unflagged.flags.hasCommodityExchange).toBeFalse();
        expect(stellarHasTradeCenter(unflagged, [
            makeJunk({ soldAt: ['nova:300'] })])).toBeFalse();
        expect(stellarNeedsJunksForTrade(unflagged)).toBeFalse();
    });
});
