import { JunkData } from 'novadatainterface/junk_data';
import { PlanetData, TradeTier } from 'novadatainterface/planet_data';
import { Cargo, cargoUsed } from '../ship/index.js';
import { evaluateNCBTest, NCBParseError } from '../ncb/index.js';
import { numericId, STANDARD_CARGO_NAMES } from '../missions/index.js';

/**
 * Commodity-exchange rules, kept pure so they can be unit tested.
 *
 * Standard commodities trade at every stellar whose spöb flags give
 * them a price tier: low = 80%, medium = 100%, high = 125% of the base
 * price. Base prices are the strings of STR# 4004 in the stock data
 * ([75, 350, 750, 900, 200, 550]); they are hardcoded here (documented
 * gap: plugins overriding STR# 4004 aren't picked up). The commodity
 * NAMES (STR# 4000) are no longer hardcoded — standardTradeGoods takes
 * the scenario's parsed PlayerStartData.cargoNames.
 *
 * Jünk commodities are bought by the player at their SoldAt stellars
 * (low tier) and sold at their BoughtAt stellars (high tier) -- the tiers
 * the original shows (reference #321). The exchange has ONE slot for each
 * tier, each taken by the highest-id jünk that qualifies, and a jünk's
 * BuyOn test gates its BoughtAt (High) row and its SellOn test its SoldAt
 * (Low) row: the stellar is the one buying or selling (reference "Trade
 * center at Schmoo ... wave 12").
 */

/** Base prices of the six standard commodities (STR# 4004). */
export const STANDARD_COMMODITY_BASE_PRICES =
    [75, 350, 750, 900, 200, 550];

/**
 * A commodity's price at a tier: exactly 80% / 100% / 125% of the base
 * price (the Bible's percentages), TRUNCATED to whole credits. Measured on
 * the original (docs/reference_experiments.md, #321): every Kit Port
 * commodity, standard and jünk, showed exactly floor(base x tier), and the
 * pilot's priceFlux globals had no effect on any price — so nothing here
 * reads pilot state. (öops price events are separate: price_events.ts.)
 */
export function tierPrice(basePrice: number, tier: TradeTier): number {
    // The original TRUNCATES fractional tier prices: Medical Supplies
    // (base 750) shows High 937, not the rounded 938 (750 x 1.25 = 937.5);
    // Equipment (550) High 687; a base-150 jünk High 187.
    switch (tier) {
        case 'low': return Math.floor(basePrice * 0.8);
        case 'med': return basePrice;
        case 'high': return Math.floor(basePrice * 1.25);
    }
}

/** One row of the trade center: a good tradeable at this stellar. */
export interface TradeGood {
    /** CargoComponent key: 'cargo:<0-5>' or 'junk:<globalID>'. */
    key: string;
    name: string;
    /** The displayed price tier. */
    tier: TradeTier;
    /** Price per ton. */
    price: number;
    /** Whether the player may buy it here (jünk: only at SoldAt). */
    canBuy: boolean;
    /** Whether the player may sell it here (jünk: only at BoughtAt). */
    canSell: boolean;
    /**
     * Set when an öops price event is active on this commodity: `price`
     * already includes the event's delta, and `direction` selects the
     * "Lower"/"Higher" tier word shown in place of Low/Med/High. `name`
     * is the event's description sentence. See price_events.ts.
     */
    event?: {
        name: string;
        direction: 'lower' | 'higher';
    };
}

/**
 * The standard-commodity rows of a stellar's exchange, in STR# order.
 * `cargoNames` is the scenario's parsed STR# 4000 names; it falls back
 * to the built-in commodity names.
 */
export function standardTradeGoods(planet: PlanetData,
    cargoNames: readonly string[] = STANDARD_CARGO_NAMES): TradeGood[] {
    const goods: TradeGood[] = [];
    planet.tradeTiers.forEach((tier, index) => {
        if (!tier) {
            return;
        }
        const base = STANDARD_COMMODITY_BASE_PRICES[index];
        if (base === undefined) {
            return;
        }
        goods.push({
            key: `cargo:${index}`,
            name: cargoNames[index] || STANDARD_CARGO_NAMES[index]
                || `Commodity ${index}`,
            tier,
            price: tierPrice(base, tier),
            canBuy: true,
            canSell: true,
        });
    });
    return goods;
}

/**
 * The jünk rows this jünk could take at this stellar: none when it doesn't
 * trade here, one when the stellar is in only one of its lists, TWO when
 * it is in both (the High row first, then the Low one; reference "#321
 * wave 10": Kit Port's Kit Doodads at High 500 and again at Low 320).
 * Whether a row is SHOWN is junkExchangeRows' slot rule.
 *
 * - High (sell-only, the high tier) where the stellar BUYS it (BoughtAt),
 *   gated by BuyOn;
 * - Low (buy-only, the low tier) where the stellar SELLS it (SoldAt),
 *   gated by SellOn.
 *
 * The control-bit tests read from the stellar's side, as the original
 * gates them (reference "Trade center at Schmoo, and the trade-in's
 * outfits, wave 12"): Schmoo is in Durknen Girns' BoughtAt list and the
 * Girns' BuyOn is b43, and the Girns' High row appears there only once bit
 * 43 is set. A malformed expression fails closed.
 */
export function junkTradeGoods(junk: JunkData, planetId: string,
    bits: Set<number>): TradeGood[] {
    const passes = (expression: string) => {
        if (!expression) {
            return true;
        }
        try {
            return evaluateNCBTest(expression,
                { getBit: bit => bits.has(bit) });
        } catch (e) {
            if (e instanceof NCBParseError) {
                console.warn(`Bad jünk ${junk.id} NCB test:`, e.message);
                return false;
            }
            throw e;
        }
    };
    const rows: TradeGood[] = [];
    if (junk.boughtAt.includes(planetId) && passes(junk.buyOn)) {
        rows.push({
            key: `junk:${junk.id}`,
            name: junk.name,
            tier: 'high',
            price: tierPrice(junk.basePrice, 'high'),
            canBuy: false,
            canSell: true,
        });
    }
    if (junk.soldAt.includes(planetId) && passes(junk.sellOn)) {
        rows.push({
            key: `junk:${junk.id}`,
            name: junk.name,
            tier: 'low',
            price: tierPrice(junk.basePrice, 'low'),
            canBuy: true,
            canSell: false,
        });
    }
    return rows;
}

/**
 * How many rows the commodity exchange lists: the six fixed standard
 * slots (kept even when the stellar does not trade that commodity), one
 * High jünk slot and one Low jünk slot.
 */
export const EXCHANGE_ROWS = 8;

/** The jünk slots below the six standard ones: one High, one Low. */
export const EXCHANGE_JUNK_ROWS = EXCHANGE_ROWS
    - STANDARD_COMMODITY_BASE_PRICES.length;

/**
 * Every jünk row this stellar's exchange shows, in display order: at most
 * ONE High (sell-here) row and ONE Low (buy-here) row, each taken by the
 * highest-id jünk with a row of that tier here (junkTradeGoods, gates
 * included), the High row listed first.
 *
 * Every original-hardware table fits this (docs/reference_experiments.md):
 *  - #321 wave 1, Kit Port: Gadgets High above Widgets Low;
 *  - #321 wave 10, Kit Port with Doodads (202, both lists), Gadgets (201)
 *    and Widgets (200): Doodads High and Doodads Low, the other two
 *    out-ranked in their tiers; Kit Market: Widgets High above Gadgets Low;
 *  - wave 12, Schmoo (stock spöb 322, in the BoughtAt lists of jünk 145
 *    Seafood Delicacies, 146 Opals and 149 Durknen Girns, BuyOn b43): with
 *    bit 43 clear, Opals High alone; with it set, Durknen Girns High alone.
 *    Three High candidates, one row.
 * Ids compare by their numeric resource number (the original's id space),
 * then by the full global id so two plug-ins' equal numbers still order
 * the same way on every client.
 */
export function junkExchangeRows(junks: readonly JunkData[], planetId: string,
    bits: Set<number>): TradeGood[] {
    const byIdDescending = [...junks].sort((a, b) => {
        const delta = (numericId(b.id) ?? -1) - (numericId(a.id) ?? -1);
        if (delta !== 0) {
            return delta;
        }
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    const candidates = byIdDescending
        .flatMap(junk => junkTradeGoods(junk, planetId, bits));
    const high = candidates.find(row => row.tier === 'high');
    const low = candidates.find(row => row.tier === 'low');
    return [high, low].filter((row): row is TradeGood => row !== undefined);
}

/** The working state a trade session edits (working copies). */
export interface TradeWorkingState {
    cargo: Cargo;
    credits: { credits: number };
    /** Total tons of cargo the ship can hold. */
    cargoCapacity: number;
}

/** Free tons in the hold (mission cargo and junk both count). */
export function freeCargoSpace(state: TradeWorkingState): number {
    return Math.max(0, state.cargoCapacity - cargoUsed(state.cargo));
}

/**
 * The most tons of the good the player could buy right now: limited by
 * credits and free hold space (0 when the good can't be bought here).
 */
export function maxBuyQuantity(state: TradeWorkingState,
    good: TradeGood): number {
    if (!good.canBuy || good.price <= 0) {
        return 0;
    }
    const affordable = Math.floor(state.credits.credits / good.price);
    return Math.max(0, Math.min(affordable, freeCargoSpace(state)));
}

/** The tons of the good the player could sell here: the held amount. */
export function maxSellQuantity(state: TradeWorkingState,
    good: TradeGood): number {
    if (!good.canSell) {
        return 0;
    }
    return Math.max(0, state.cargo.get(good.key) ?? 0);
}

/**
 * Buys up to `quantity` tons, clamped to what fits and is affordable
 * (the option-click bulk rule — an over-entered amount buys the most
 * allowed). Returns the tons bought.
 */
export function buyGoodQuantity(state: TradeWorkingState, good: TradeGood,
    quantity: number): number {
    const bought = Math.min(Math.floor(quantity), maxBuyQuantity(state, good));
    if (bought <= 0) {
        return 0;
    }
    state.credits.credits -= bought * good.price;
    state.cargo.set(good.key, (state.cargo.get(good.key) ?? 0) + bought);
    return bought;
}

/**
 * Buys as many tons as fit and are affordable, the original's
 * one-click behavior. Returns the tons bought (0 when out of money or
 * space).
 */
export function buyGood(state: TradeWorkingState, good: TradeGood): number {
    return buyGoodQuantity(state, good, maxBuyQuantity(state, good));
}

/**
 * Sells up to `quantity` tons, clamped to the held amount (the
 * option-click bulk rule). Returns the tons sold. Mission cargo is
 * untouchable: it lives under 'mission:*' keys which are never
 * TradeGood keys.
 */
export function sellGoodQuantity(state: TradeWorkingState, good: TradeGood,
    quantity: number): number {
    const sold = Math.min(Math.floor(quantity), maxSellQuantity(state, good));
    if (sold <= 0) {
        return 0;
    }
    const held = state.cargo.get(good.key) ?? 0;
    if (sold >= held) {
        state.cargo.delete(good.key);
    } else {
        state.cargo.set(good.key, held - sold);
    }
    state.credits.credits += sold * good.price;
    return sold;
}

/**
 * Sells the entire held quantity of the good, the original's one-click
 * behavior. Returns the tons sold.
 */
export function sellGood(state: TradeWorkingState, good: TradeGood): number {
    return sellGoodQuantity(state, good, maxSellQuantity(state, good));
}

/**
 * Tons of cargo aboard that no TradeGood row covers (mission cargo
 * and junk that doesn't trade here), for the "Other cargo" line.
 * Mission cargo reports its tonnage — "5 tons of mission cargo" — as
 * in the trade_center_port_kane_with_mission_cargo reference
 * screenshot.
 */
export function otherCargoNames(cargo: Cargo,
    goods: TradeGood[]): string[] {
    const tradeable = new Set(goods.map(g => g.key));
    const names: string[] = [];
    let missionTons = 0;
    for (const [key, count] of cargo) {
        if (count <= 0 || tradeable.has(key)) {
            continue;
        }
        if (key.startsWith('mission:')) {
            missionTons += count;
        } else {
            names.push(key);
        }
    }
    const result = [...new Set(names)];
    if (missionTons > 0) {
        result.unshift(`${missionTons} ton${missionTons === 1 ? '' : 's'}`
            + ' of mission cargo');
    }
    return result;
}
