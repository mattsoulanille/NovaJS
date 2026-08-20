/**
 * The shared per-day "is this on the shelf today?" roll.
 *
 * THE RULE. Both shop resources carry a percent chance that decides
 * whether an item is offered on a given day, and the EVN Bible words them
 * identically:
 *
 *   - oütf BuyRandom (~:2034): "The percent chance that an item of this
 *     type will be available for purchase on a given day, from 1-100.
 *     Values less than 1 or greater than 100 are interpreted as 100."
 *   - shïp BuyRandom (~:2628) / HireRandom (~:2632): the same, for the
 *     shipyard and for the bar's hire pool.
 *
 * It is what a plug-in uses to model a shop's changing stock, and — the
 * case that brought this module into being — a CHOICE between mutually
 * exclusive items. Extra Outfits hires bridge officers that way: each of
 * its six officer posts has three candidate oütfs (a poor one, an ordinary
 * one and a good one) whose Availability excludes the other two, and the
 * three carry BuyRandom 50 / 25 / 15, so on most days at most one of them
 * has turned up looking for the job. Without the roll all three sit on the
 * shelf at once, and the shop looks like it is selling three of the same
 * officer.
 *
 * DETERMINISM. NovaJS runs the shops on every peer, so the day's stock has
 * to agree across clients AND across a reload of the same day: Math.random
 * and Date.now are forbidden here. The roll is a pure function of the
 * things that distinguish "this item, at this stellar, on this day":
 *
 *     hash = FNV-1a 32-bit over "salt|day|stellarId|resourceNumber"
 *     offered = (hash % 100) < percent
 *
 * FNV-1a is a single trivial integer loop (no allocations, identical on
 * every JS engine) and spreads a day's availability across the percent
 * bands evenly enough for the 0-100 values real data uses. The `salt` is
 * the shop, so the same hull rolled for the shipyard and for the bar's
 * hire pool does not share one coin flip, and an outfit's roll is
 * independent of both.
 *
 * JUDGMENT CALL — the hash deliberately does NOT include the player: the
 * Bible's "available for purchase on a given day" is a property of the
 * ITEM and the DAY at a shop, shared by everyone visiting it. Including
 * the player would also make the grid differ between two players docked at
 * the same stellar on the same day, which nothing in the original
 * suggests.
 */

/**
 * Master switch for the per-day roll (Matthew, 2026-08-14: disabled for
 * now). While off, anything with a NONZERO percentage is offered every
 * day; a percentage of ZERO keeps its Bible meaning ("never be made
 * available") regardless of the switch, since that is a permanent property
 * of the item, not the randomized daily part.
 *
 * DESIGN RULING (Matthew, 2026-08-14) for when this is re-enabled: the
 * daily roll applies to BOTH the shipyard and the outfitter, and a failed
 * roll HIDES the item from the grid entirely — not a grey "isn't for sale
 * today" tile, which exists only as the purchase-side backstop. Both shops
 * are wired that way already (shipyard_stock_rules' buyVisible and
 * outfitter_rules' buyVisible), so flipping this one constant is the whole
 * of turning it on.
 */
export const BUY_RANDOM_DAY_ROLL_ENABLED = false;

/** Where a day roll is being made — the salt that keeps shops independent. */
export type DayRollShop = 'buy' | 'hire' | 'outfit';

/** Everything a day roll needs about where and when it is being made. */
export interface DayRollContext {
    /**
     * The absolute game day number (calendar.ts dayNumber), or undefined
     * when the caller has no calendar — a headless purchase check, say.
     * Undefined means "no roll": the item is offered, exactly as it is
     * with the master switch off.
     */
    day?: number;
    /** The numeric local id of the shop's stellar, or null/undefined. */
    stellarId?: number | null;
}

/**
 * The day's 0-99 roll for one resource at one stellar in one shop.
 * Exported so the mechanism stays under test while the master switch is
 * off.
 */
export function dayRoll(shop: DayRollShop, resourceNumber: number,
    context: DayRollContext): number {
    return fnv1a(`${shop}|${context.day ?? 0}|${context.stellarId ?? 0}`
        + `|${resourceNumber}`) % 100;
}

/**
 * Whether an item with this percentage is on the shelf today.
 *
 * Zero (or less) is the Bible's permanent "never made available" and is
 * refused whatever the switch says; 100 or more is always offered ("values
 * ... greater than 100 are interpreted as 100"); anything between rolls,
 * but only once the master switch is on AND the caller supplied a day.
 */
export function passesDayRoll(percent: number, shop: DayRollShop,
    resourceNumber: number, context: DayRollContext): boolean {
    // Strictly zero, matching neverOnSale: the Bible's "values less than
    // 1 ... interpreted as 100" is overridden by the data-derived
    // BuyRandom-0 ruling for 0 ONLY; a negative percent stays on the
    // Bible's side and is always offered (review r16 LOW — no stock
    // resource has one; nova:348 is hidden by its other gates).
    if (percent === 0) {
        return false;
    }
    if (percent < 0 || percent >= 100) {
        return true;
    }
    if (!BUY_RANDOM_DAY_ROLL_ENABLED || context.day === undefined) {
        return true;
    }
    return dayRoll(shop, resourceNumber, context) < percent;
}

/**
 * The numeric resource id inside a global id like "nova:128" (128), or
 * null when there isn't one.
 */
export function resourceNumber(globalId: string): number | null {
    const parsed = parseInt(globalId.slice(globalId.lastIndexOf(':') + 1), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

/** FNV-1a 32-bit hash of a string (offset basis 2166136261, prime
 * 16777619). Deterministic, allocation-light, identical across engines. */
function fnv1a(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}
