import { OopsData } from 'novadatainterface/oops_data';
import { evaluateNCBTest, NCBParseError } from '../ncb/index.js';
import { STANDARD_COMMODITY_BASE_PRICES, TradeGood } from './trade_logic.js';

/**
 * Commodity price events (öops "planetary disasters", EVN Bible p. 42).
 *
 * The Bible defines each öops as: a per-day `freq` percent chance to
 * start, a `duration` in days, and a `priceDelta` shift applied to one
 * standard commodity's price at a stellar while active. The original
 * rolls this each day and tracks the active events as mutable state.
 *
 * Here it is instead a PURE DETERMINISTIC function of (öops resource,
 * player game-date day number): every peer computes the same events for
 * the same player's date with no Math.random and no wall-clock input, so
 * trade stays in sync in rollback multiplayer. An event is "active" on
 * day D iff its per-day start roll fired on some day S in the window
 * (D - duration, D] — i.e. a start within the last `duration` days that
 * is still running. The roll is a seeded integer hash of the resource id
 * and the day; using only integer/bitwise ops keeps it bit-identical
 * across JS engines (no trig, no floats in the seed path).
 */

/** FNV-1a hash of a string to a uint32 seed. Integer ops only. */
function stringSeed(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * A uint32 pseudo-random value from (seed, day). A mulberry32-style
 * integer mix — deterministic and bit-identical on every engine.
 */
function hashRoll(seed: number, day: number): number {
    // Fold the (possibly negative) day into the seed with an odd
    // constant so consecutive days decorrelate.
    let h = (seed + Math.imul(day | 0, 0x9e3779b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return (h ^ (h >>> 14)) >>> 0;
}

/**
 * Whether `oops`'s per-day start roll fires on absolute day `day`.
 * `freq` is a whole percent (0-100); the roll is compared against
 * `freq / 100` at a 1/10000 resolution.
 */
export function eventStartsOn(oops: OopsData, day: number): boolean {
    if (oops.freq <= 0) {
        return false;
    }
    const roll = hashRoll(stringSeed(oops.id), day) % 10000;
    return roll < oops.freq * 100;
}

/**
 * Whether `oops` is active on absolute day `day`: a start fired within
 * the last `duration` days and is still running. Returns false for
 * degenerate resources (no duration or no chance to start).
 */
export function isEventActive(oops: OopsData, day: number): boolean {
    if (oops.duration <= 0 || oops.freq <= 0) {
        return false;
    }
    for (let start = day - oops.duration + 1; start <= day; start++) {
        if (eventStartsOn(oops, start)) {
            return true;
        }
    }
    return false;
}

/** An active price event affecting one commodity at a stellar. */
export interface ActivePriceEvent {
    /** Standard commodity index 0-5. */
    commodity: number;
    /** Credits added to the price (negative = cheaper). */
    priceDelta: number;
    /** The öops resource's name, a sentence shown in the exchange. */
    name: string;
}

/** Whether an öops's Stellar field matches the docked planet. */
function matchesPlanet(oops: OopsData, planetId: string): boolean {
    return oops.appliesToAll || oops.stellar === planetId;
}

function passesActivate(activateOn: string, bits: Set<number>,
    oopsId: string): boolean {
    if (!activateOn) {
        return true;
    }
    try {
        return evaluateNCBTest(activateOn, { getBit: bit => bits.has(bit) });
    } catch (e) {
        if (e instanceof NCBParseError) {
            console.warn(`Bad öops ${oopsId} ActivateOn test:`, e.message);
            return false;
        }
        throw e;
    }
}

/**
 * The price events active at `planetId` on absolute day `day`, at most
 * one per commodity. When several öops resources affect the same
 * commodity simultaneously the lowest-id one wins (deterministic; the
 * original shows a single price/name per commodity). `bits` gates each
 * event's ActivateOn NCB test.
 */
export function activePriceEvents(oopses: readonly OopsData[],
    planetId: string, day: number, bits: Set<number>): ActivePriceEvent[] {
    const byCommodity = new Map<number, ActivePriceEvent>();
    const sorted = [...oopses].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const oops of sorted) {
        if (oops.commodity < 0 || byCommodity.has(oops.commodity)) {
            continue;
        }
        if (!matchesPlanet(oops, planetId)) {
            continue;
        }
        if (!passesActivate(oops.activateOn, bits, oops.id)) {
            continue;
        }
        if (!isEventActive(oops, day)) {
            continue;
        }
        byCommodity.set(oops.commodity, {
            commodity: oops.commodity,
            priceDelta: oops.priceDelta,
            name: oops.name,
        });
    }
    return [...byCommodity.values()];
}

/** The standard-commodity index of a TradeGood key, or null. */
function commodityIndex(key: string): number | null {
    const match = /^cargo:(\d+)$/.exec(key);
    return match ? Number(match[1]) : null;
}

/**
 * Applies active price events to a list of standard-commodity trade
 * goods, returning new rows with the adjusted price and an `event`
 * annotation (which drives the "Lower"/"Higher" tier word).
 *
 * A price event overrides the stellar's normal price tier: the price
 * becomes `basePrice + priceDelta`, NOT tierPrice + delta. This matches
 * the Port Kane reference screenshot, where food (normally the "high"
 * tier, base 75 -> 94) shows 60 under a -15 surplus — i.e. 75 - 15, the
 * base price plus the delta. The price is clamped to a minimum of 1
 * credit so an over-large negative delta can't make a good free. Jünk
 * rows (non-cargo keys) are never affected.
 */
export function applyPriceEvents(goods: readonly TradeGood[],
    events: readonly ActivePriceEvent[]): TradeGood[] {
    const byCommodity = new Map(events.map(e => [e.commodity, e]));
    return goods.map(good => {
        const index = commodityIndex(good.key);
        if (index === null) {
            return { ...good };
        }
        const event = byCommodity.get(index);
        const base = STANDARD_COMMODITY_BASE_PRICES[index];
        if (!event || base === undefined) {
            return { ...good };
        }
        return {
            ...good,
            price: Math.max(1, base + event.priceDelta),
            event: {
                name: event.name,
                direction: event.priceDelta < 0 ? 'lower' : 'higher',
            },
        };
    });
}
