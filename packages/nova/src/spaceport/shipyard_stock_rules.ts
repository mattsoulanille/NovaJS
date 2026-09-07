/**
 * The shïp resource's STOCK gates — which ships a stellar offers, and
 * whether the player may take one. Used by BOTH shops that hand out
 * whole ships:
 *
 *   - the SHIPYARD (spöb hasShipyard), which sells hulls; and
 *   - the BAR's hire-escort dialog (spöb hasBar), which hires pilots.
 *
 * They share every gate except the daily roll: the shipyard rolls
 * BuyRandom, the bar rolls HireRandom (EVN Bible ~:2630/~:2634). Both
 * quote {@link shipStockGatesPass} for the rest, so a ship can never be
 * hireable at a stellar that would not stock it.
 *
 * Per the EVN Bible's shïp documentation:
 *
 *   - TechLevel (~:2413): "This ship will be available at all shipyards
 *     with a tech level of this value or higher" — with the spöb
 *     SpecialTech exact-match exception (~:2765).
 *   - Availability (~:2588): "Control bit test expression. The player
 *     will be able to purchase this type of ship when the expression
 *     evaluates to true."
 *   - Require (~:2620): "If for each 1 bit in the Require fields
 *     there is a matching 1 bit in one or more of the Contribute
 *     fields, the ship can be purchased."
 *   - BuyRandom (~:2630): "The percent chance that a ship of this type
 *     will be available for purchase on a given day. A BuyRandom of 0
 *     means this ship will never be made available for purchase."
 *   - HireRandom (~:2634): "The percent chance that a ship of this type
 *     will be available for hire in the bar on a given day. A HireRandom
 *     of 0 means this ship will never be made available for hire."
 *   - Flags3 0x0100 / 0x0200 / 0x4000 (~:2655-2658).
 *
 * Pure logic; the Shipyard menu supplies the context. This module is the
 * shipyard's counterpart to outfitter_rules.ts, and deliberately REUSES
 * that file's generic pieces (meetsTechLevel, the NCB evaluator) rather
 * than duplicating them.
 */
import { ShipData } from 'novadatainterface/ship_data';
import { meetsTechLevel } from './outfitter_rules.js';
import { evaluateNCBTest, NCBParseError } from '../nova_plugin/ncb/index.js';
import {
    BUY_RANDOM_DAY_ROLL_ENABLED, dayRoll as sharedDayRoll, DayRollShop,
    passesDayRoll, resourceNumber,
} from './day_roll.js';

export { BUY_RANDOM_DAY_ROLL_ENABLED };

export interface ShipyardStellar {
    /** Everything with techLevel <= this is stocked (spöb TechLevel). */
    techLevel: number;
    /** Extra tech levels stocked by EXACT match only (spöb SpecialTech). */
    specialTech: readonly number[];
    /**
     * The global id of the gövt that OWNS this stellar (spöb Govt), or null.
     * Not a stock gate — it is what a ränk PriceMod is matched against
     * (price_mod.ts). Optional so the many callers that only care about tech
     * levels need not name it.
     */
    govt?: string | null;
}

/**
 * Everything the shipyard's visibility and purchase rules need about the
 * player and the shipyard they are standing in.
 */
export interface ShipyardContext {
    /**
     * The stellar the player is docked at (its tech level / SpecialTech).
     * Absent means "no shipyard context", under which every ship is stocked —
     * the behaviour a headless purchase test (no real planet) wants, and
     * the boundary at which a caller that only cares about the purchase
     * gates stays free of docked-planet boilerplate.
     */
    planet?: ShipyardStellar;
    /** The player's control bits (ControlBitsComponent). */
    bits: ReadonlySet<number>;
    /**
     * The union of the Contribute flag sets of the player's current ship
     * and every outfit it carries (see playerContribute below).
     */
    contribute: bigint;
    /**
     * The absolute game day number (calendar.ts dayNumber). Drives the
     * deterministic BuyRandom roll.
     */
    day: number;
    /** The numeric local id of the docked stellar, or null. */
    stellarId: number | null;
    /**
     * The ränk PriceMod percentage in force here (price_mod.ts). Absent
     * means 100 — prices unchanged. Not a stock gate: the shipyard's grid
     * shows the same ships either way, they are just priced differently.
     */
    priceMod?: number;
}

/**
 * The shipyard's counterpart to the outfitter's playerContribute: the
 * union of the contributing ship+outfit flag sets the player currently has.
 * In the shipyard the player always owns a ship, so this is the current
 * hull's contribute or'd with the contribute of each owned outfit.
 */
export function playerContribute(shipContribute: string,
    outfits: ReadonlyMap<string, string>): bigint {
    let contribute = BigInt(shipContribute ?? '0x0');
    for (const value of outfits.values()) {
        contribute |= BigInt(value ?? '0x0');
    }
    return contribute;
}

/**
 * Whether the player's Contribute set covers this ship's Require flags. An
 * empty Require (0) always passes.
 */
export function shipRequirementsMet(requireHex: string,
    contribute: bigint): boolean {
    const require = BigInt(requireHex ?? '0x0');
    return (require & contribute) === require;
}

/**
 * Whether the ship's Availability control-bit test passes. Malformed
 * expressions log and count as available, matching the blank-expression
 * default — the same policy as the outfitter's availabilityTest.
 */
export function shipAvailabilityPasses(ship: ShipData,
    ctx: ShipyardContext): boolean {
    if (!ship.availability) {
        return true;
    }
    try {
        // The stock Availability expressions are pure control-bit tests
        // (bXXX / P30); the exotic NCB terms default harmlessly.
        return evaluateNCBTest(ship.availability, {
            getBit: bit => ctx.bits.has(bit),
        });
    } catch (error) {
        if (error instanceof NCBParseError) {
            console.warn(`Bad Availability for ship ${ship.id}:`, error);
            return true;
        }
        throw error;
    }
}

/**
 * Whether the shipyard has one of these on the lot today: the Bible's
 * "percent chance that a ship of this type will be available for purchase
 * on a given day", rolled deterministically (day_roll.ts, which documents
 * the hash and the master switch). BuyRandom 0 is the permanent "never
 * made available for purchase" and is refused whatever the switch says.
 */
export function shipBuyRandomPasses(ship: ShipData,
    ctx: ShipyardContext): boolean {
    return passesDayRoll(ship.buyRandom, 'buy',
        resourceNumber(ship.id) ?? 0, ctx);
}

/**
 * The day's 0-99 roll for this ship at this shipyard — compared against
 * BuyRandom when {@link BUY_RANDOM_DAY_ROLL_ENABLED}. Exported so the roll
 * mechanism stays under test while the switch is off.
 */
export function buyRandomDayRoll(ship: ShipData,
    ctx: ShipyardContext): number {
    return dayRoll('buy', ship, ctx);
}

/**
 * Whether the bar offers a pilot flying this ship class today (the shïp
 * HireRandom half of the daily roll). Unlike BuyRandom's, this roll is
 * LIVE: the hire pool has always rolled, and there is no equivalent of
 * {@link BUY_RANDOM_DAY_ROLL_ENABLED} to switch it off.
 */
export function shipHireRandomPasses(ship: ShipData,
    ctx: ShipyardContext): boolean {
    return passesDayRollLive(ship.hireRandom, 'hire', ship, ctx);
}

/**
 * The day's 0-99 roll for a pilot of this ship class at this stellar,
 * compared against HireRandom. Salted differently from
 * {@link buyRandomDayRoll} so a ship sold in the shipyard and hired in the
 * bar do not share one coin flip.
 */
export function hireRandomDayRoll(ship: ShipData,
    ctx: ShipyardContext): number {
    return dayRoll('hire', ship, ctx);
}

/**
 * The shared "this ship at this stellar on this day" roll. Salted per
 * shop so the bar and the shipyard draw independently (day_roll.ts).
 */
function dayRoll(salt: DayRollShop, ship: ShipData,
    ctx: ShipyardContext): number {
    return sharedDayRoll(salt, resourceNumber(ship.id) ?? 0, ctx);
}

/**
 * The hire pool's roll, which is LIVE: it has always rolled, and there is
 * no equivalent of the shipyard's master switch to turn it off. Zero and
 * >= 100 keep their Bible meanings.
 */
function passesDayRollLive(percent: number, salt: DayRollShop,
    ship: ShipData, ctx: ShipyardContext): boolean {
    if (percent <= 0) {
        return false;
    }
    if (percent >= 100) {
        return true;
    }
    return dayRoll(salt, ship, ctx) < percent;
}

export type ShipyardDenialReason =
    | 'notStocked'
    | 'availability'
    | 'require'
    | 'notAvailableToday'
    | 'credits';

export type ShipyardCheck =
    | { allowed: true }
    | { allowed: false, reason: ShipyardDenialReason, message: string };

function denied(reason: ShipyardDenialReason, message: string):
    ShipyardCheck {
    return { allowed: false, reason, message };
}

/**
 * Whether the docked shipyard STOCKS this ship (its tech level / SpecialTech
 * gate — the same rule the outfitter uses). No planet context means "no
 * shipyard", which stocks everything.
 */
export function shipStocked(ship: ShipData, ctx: ShipyardContext): boolean {
    return !ctx.planet
        || meetsTechLevel(ship.techLevel, ctx.planet);
}

/**
 * Whether the ship is "available for sale" here today, in the sense the
 * Flags3 0x4000 rule uses: stocked on tech, Require met, Availability
 * passes, and the day's BuyRandom roll comes up. This deliberately ignores
 * transient affordability (credits) — a full wallet or empty one does not
 * change which ship the shop is OFFERING, only whether the player can take it.
 */
export function shipAvailableForSale(ship: ShipData,
    ctx: ShipyardContext): boolean {
    return shipStockGatesPass(ship, ctx)
        && shipBuyRandomPasses(ship, ctx);
}

/**
 * THE shared gate both ship shops apply before their own daily roll:
 * the stellar stocks this tech level (TechLevel / SpecialTech), the
 * player's Contribute covers its Require, and its Availability control-bit
 * expression passes.
 *
 * The shipyard adds BuyRandom on top ({@link shipAvailableForSale}); the
 * bar's hire pool adds HireRandom ({@link shipHireable}). Keeping the
 * three gates in one place is what stops the two shops from drifting
 * apart — the bar used to test only `techLevel <= planet.techLevel`,
 * which silently emptied the hire pool at every SpecialTech-only stellar
 * (Extra Outfits' Tektaara Station: spöb TechLevel -1, SpecialTech 10000,
 * where the tech-10000 Anti-Missile Drone is the whole pool).
 */
export function shipStockGatesPass(ship: ShipData,
    ctx: ShipyardContext): boolean {
    return shipStocked(ship, ctx)
        && shipRequirementsMet(ship.require, ctx.contribute)
        && shipAvailabilityPasses(ship, ctx);
}

/**
 * Whether a pilot flying this ship class is in the bar's hire pool at
 * this stellar today: the shared stock gates, a nonzero price (the hire
 * fee is a percentage of it — see hire_escort.hirePrice), and the day's
 * HireRandom roll.
 *
 * Deliberately NOT gated on BuyRandom: a ship the shipyard never sells
 * can still be hired (Extra Outfits' drones and stock Nova's second-hand
 * hulls, nova:361-372, all have BuyRandom 0 and a nonzero HireRandom),
 * and the Bible keeps the two rolls in separate fields for exactly that
 * reason.
 */
export function shipHireable(ship: ShipData, ctx: ShipyardContext): boolean {
    // The LIST price, not the ränk-modified one (price_mod.ts): a hull that
    // is free at this stellar still has a pilot at the bar, offering it for
    // nothing — which is exactly what Extra Outfits' Spica Shipyard is for.
    return ship.price > 0
        && shipStockGatesPass(ship, ctx)
        && shipHireRandomPasses(ship, ctx);
}

/**
 * Every gate a ship must clear before the player is allowed to BUY it:
 * stocked, Availability, Require, the day's BuyRandom roll. The Shipyard
 * quotes this for its Buy button / purchase path; the grid quotes
 * visibleShips, and the two share shipStocked/shipRequirementsMet/
 * shipAvailabilityPasses/shipBuyRandomPasses underneath so they can never
 * disagree.
 */
export function canBuyShip(ship: ShipData,
    ctx: ShipyardContext): ShipyardCheck {
    if (!shipStocked(ship, ctx)) {
        return denied('notStocked', 'They don\'t sell this here.');
    }
    if (!shipAvailabilityPasses(ship, ctx)) {
        return denied('availability', 'Not available.');
    }
    if (!shipRequirementsMet(ship.require, ctx.contribute)) {
        return denied('require', 'You lack something this requires.');
    }
    if (!shipBuyRandomPasses(ship, ctx)) {
        // BuyRandom 0 is a permanent "never sold", not a bad day.
        return denied('notAvailableToday', ship.buyRandom <= 0
            ? 'This ship isn\'t for sale.'
            : 'This ship isn\'t for sale today.');
    }
    return { allowed: true };
}

/**
 * A total order on ship global ids matching what the Flags3 0x4000 rule
 * means by "higher-numbered": the numeric resource id. Mirrors
 * outfitter_rules.compareOutfitIds — the original's shïp space is a single
 * flat id space, so the resource NUMBER is what is compared (the NovaJS
 * "prefix:" namespacing only breaks ties).
 */
export function compareShipIds(a: string, b: string): number {
    const [numA, numB] = [resourceNumber(a), resourceNumber(b)];
    if (numA !== numB) {
        if (numA === null) return 1;
        if (numB === null) return -1;
        return numA - numB;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether this ship passes the BUY-side visibility gates before the 0x4000
 * exclusion pass. Per the Bible, failing Availability or Require WITHOUT the
 * matching 0x0100/0x0200 hide-flag is NOT a visibility failure: the
 * ship still shows (greyed, purchase refused); only the hide-flags drop it.
 */
function buyVisible(ship: ShipData, ctx: ShipyardContext): boolean {
    if (!shipStocked(ship, ctx)) {
        return false;
    }
    // A ship that is never for sale (BuyRandom 0 — Vell-os craft,
    // mission-only variants) is HIDDEN, not shown greyed as "isn't for
    // sale" (Matthew, 2026-08-15: hide ships that aren't for sale). This
    // is the same treatment his ruling gives a failed day roll once
    // BUY_RANDOM_DAY_ROLL_ENABLED returns: not-for-sale means absent.
    if (!shipBuyRandomPasses(ship, ctx)) {
        return false;
    }
    if (ship.hideIfAvailabilityFalse
        && !shipAvailabilityPasses(ship, ctx)) {
        return false;
    }
    if (ship.hideIfRequireUnmet
        && !shipRequirementsMet(ship.require, ctx.contribute)) {
        return false;
    }
    return true;
}

/**
 * The ships the shipyard shows, in display order (DispWeight descending —
 * "Ships with a higher display weight are shown closer to the top of the
 * shipyard dialog", Bible ~:2451 — with ties broken by ascending id for a
 * deterministic, resource-order list).
 *
 * BuyRandom and visibility: the day roll is currently DISABLED
 * ({@link BUY_RANDOM_DAY_ROLL_ENABLED}), so only BuyRandom 0 ("never
 * sold") affects the shop at all. Per Matthew's ruling a failed day roll
 * HIDES the ship from this list rather than greying it, which is what
 * buyVisible below does; the outfitter now shares both the mechanism and
 * that treatment (day_roll.ts, outfitter_rules' buyVisible). The Flags3
 * 0x4000 exclusion below keys on "available for sale today", which
 * includes the BuyRandom gate.
 */
export function visibleShips(ships: Iterable<ShipData>,
    ctx: ShipyardContext): ShipData[] {
    const ordered = [...ships].sort((a, b) =>
        b.displayWeight - a.displayWeight
        || compareShipIds(a.id, b.id));

    // 0x4000 (~:2657): "When this ship is available for sale, it
    // prevents all higher-numbered ship types with equal DispWeight from
    // being made available for sale at the same time." Exclusion is driven
    // only by ships that are themselves available for sale today, and it
    // suppresses the higher-numbered equal-DispWeight ships the way the
    // outfitter's 0x1000 does.
    const excluders = ordered.filter(ship => ship.excludeEqualDisplayWeight
        && shipAvailableForSale(ship, ctx));
    const excluded = new Set<string>();
    for (const excluder of excluders) {
        for (const other of ordered) {
            if (other.displayWeight === excluder.displayWeight
                && compareShipIds(other.id, excluder.id) > 0) {
                excluded.add(other.id);
            }
        }
    }

    return ordered.filter(ship =>
        buyVisible(ship, ctx) && !excluded.has(ship.id));
}
