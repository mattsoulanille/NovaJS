import { ShipData } from 'novadatainterface/ship_data';
import { modifiedPrice } from './price_mod.js';

/**
 * ============================================================================
 * What an escort costs and what it is worth — ONE place
 * ============================================================================
 *
 * Four numbers hang off an escort's CURRENT ship class, and they all live
 * here so that the bar, the comm dialog, the simulation and the daily
 * expenses readout cannot disagree about any of them:
 *
 *   {@link hirePrice}        the one-time fee to hire the pilot (the bar)
 *   {@link escortDailyFee}   the wage a HIRED escort draws every day
 *   {@link escortUpgradeCost} what upgrading it to its UpgradeTo class costs
 *   {@link escortSellValue}  what selling a CAPTURED escort pays
 *
 * "CURRENT ship class" is the load-bearing part. Upgrading an escort
 * replaces its class in place (nova_plugin/escort_action.ts), and because
 * every one of these is a pure function of the class the escort is flying
 * right now, an upgrade automatically raises the wage, changes what a
 * further upgrade costs, and changes what the hull would sell for. Nothing
 * has to remember the price the escort was hired at.
 *
 * ---------------------------------------------------------------------------
 * THE BIBLE'S RULES, AND THE TWO ASSUMPTIONS
 * ---------------------------------------------------------------------------
 *
 * EVN Bible shïp (~:2661) gives three fields verbatim:
 *
 *   UpgradeTo     "If an escort ship of this type can be upgraded, this field
 *                  holds the ID of the ship type that it can be upgraded to.
 *                  Set to 0 or -1 if this ship class can't be upgraded."
 *   EscUpgrdCost  "The cost to upgrade an escort ship of this type to the next
 *                  more advanced version, as defined in the UpgradeTo field."
 *   EscSellValue  "The amount of cash the player gets for selling off a
 *                  captured escort of this type. If you input a number that's
 *                  less than or equal to zero here, Nova will default to 10%
 *                  of the ship's original cost."
 *
 * Those three are DATA, so they are exact. Verified against the real Nova
 * data and the original-hardware captures (see escort_fees_test.ts):
 * hail/hail_escort.png's Terrapin (shïp nova:136) reads "Upgrade Cost:
 * 50,000 credits" and shïp 136's EscUpgrdCost is 50,000;
 * hail/hail_captured_escort.png's Pirate Viper (shïp nova:166, cost
 * 110,000, EscSellValue 0) reads "Sell Price: 11,000 credits", which is the
 * Bible's 10% default exactly.
 *
 * The two the Bible does NOT give are the HIRE fee and the DAILY WAGE:
 *
 *  - HIRE = 10% of the ship's price. Not in the Bible, but pinned by the
 *    original: bar/hire_escort/select_escort.png offers a Cargo Drone
 *    (shïp cost 2,000) at "Hiring Price: 200 cr". This is the rule NovaJS
 *    already shipped and it survives the check.
 *
 *  - DAILY WAGE = 10% of the hire fee (i.e. 1% of the ship's price). THIS
 *    IS AN ASSUMPTION, and it is the one number here that the reference
 *    capture disagrees with: hail_escort.png's Terrapin (cost 150,000, so
 *    hire 15,000) draws "Pay: 1,100 credits per day" where this rule says
 *    1,500. One sample is not enough to reverse-engineer the original's
 *    formula — 1,100 is 0.733% of the hull price and matches no obvious
 *    function of the class's cost, crew (4), strength (20) or mass (175) —
 *    so rather than invent a fit to one point, the wage follows the shape
 *    Matthew specified (a fixed fraction of the hire fee) and the
 *    discrepancy is recorded here and pinned in the specs. If the real
 *    formula is ever recovered, THIS FUNCTION is the only thing that moves.
 *
 * ---------------------------------------------------------------------------
 * WHERE ränk PriceMod APPLIES, AND WHERE IT DOES NOT
 * ---------------------------------------------------------------------------
 *
 * PriceMod is, in the Bible's own words, about "the prices of items and
 * ships at planets owned by the affiliated government" (price_mod.ts). So:
 *
 *  - HIRING is a purchase made at a stellar, in the bar, with a stellar's
 *    owner to be favoured by — it takes the modifier, and always has
 *    (Extra Outfits' Spica Shipyard hires its free hulls' pilots for 0 cr).
 *  - UPGRADING, SELLING and the daily WAGE are struck over a comm channel
 *    in deep space. There is no planet, no owning government, and so no
 *    modifier to apply: these three take the LIST price. Passing a
 *    modifier is still possible (every function takes the same optional
 *    argument) so that a future "upgrade at the shipyard" flow, or a
 *    different ruling on the wage, is one argument away rather than a
 *    rewrite — but the default, and what the comm dialog uses, is
 *    unmodified.
 *
 * Every function here is pure, total, and free of clocks and randomness,
 * so the display dialog quotes exactly what the simulation charges.
 */

/** The hire fee is this fraction of the (modified) ship price. */
export const ESCORT_HIRE_FRACTION = 0.10;

/** The daily wage is this fraction of the hire fee. See the caveat above. */
export const ESCORT_DAILY_FRACTION = 0.10;

/**
 * EVN Bible shïp EscSellValue: a value <= 0 "will default to 10% of the
 * ship's original cost".
 */
export const ESCORT_SELL_DEFAULT_FRACTION = 0.10;

/**
 * The one-time fee to hire an escort: 10% of the ship's price.
 *
 * Pinned by the original — bar/hire_escort/select_escort.png quotes a
 * 2,000 cr Cargo Drone at "Hiring Price: 200 cr", and a 300,000 cr
 * Thunderhead hires for 30,000 — though the exact rule is not in the Bible.
 *
 * The 10% is taken on the price AFTER the docked stellar's ränk PriceMod
 * (price_mod.ts) — hiring is buying a ship's services, so a rank that makes
 * a hull free here makes hiring its pilot free too. That is exactly what
 * Extra Outfits' Spica Shipyard is for: the four PriceMod-1 ranks its "Buy
 * Station" outfit grants (extra-outfits:168-171, gövt extra-outfits:302)
 * compound to 1e-6 percent, so every hull the station builds hires for 0 cr
 * because the player already paid to construct it.
 *
 * (Defined here rather than in hire_escort.ts, which it used to live in, so
 * that the wage below can be derived from it without dragging PIXI and the
 * whole bar dialog into the simulation's import graph. hire_escort.ts
 * re-exports it, so the bar's own callers are unchanged.)
 */
export function hirePrice(ship: ShipData, priceMod?: number): number {
    return Math.round(
        modifiedPrice(ship.price, priceMod) * ESCORT_HIRE_FRACTION);
}

/**
 * What a HIRED escort of this class draws per day: 10% of its hire fee,
 * i.e. 1% of the ship's price.
 *
 * A CAPTURED escort draws nothing — it is property, not an employee — so
 * callers gate on provenance (player_escort.ts's `provenance`) rather than
 * this function returning zero for them.
 *
 * Read off the escort's CURRENT class, which is what makes an upgrade raise
 * the wage with nothing else to update. See the module comment for the one
 * reference capture this disagrees with (1,500 here vs the original's 1,100
 * for a Terrapin) and why the shape was kept anyway.
 *
 * `priceMod` defaults to unmodified: a recurring wage is not a price paid
 * at a rank-owned world (see the module comment). It is accepted so the
 * ruling can be changed in one place.
 */
export function escortDailyFee(ship: ShipData, priceMod?: number): number {
    return Math.round(hirePrice(ship, priceMod) * ESCORT_DAILY_FRACTION);
}

/**
 * The ship class an escort of this class upgrades to, or null when it has
 * none. Both of the Bible's "can't be upgraded" sentinels (0 and -1) are
 * already normalized to null by the parser (novaparse ship_parse.ts), so
 * this is a plain read — it exists so that callers name a rule rather than
 * a field, and so the null-handling is documented in one place.
 */
export function escortUpgradeShip(ship: ShipData): string | null {
    return ship.escortUpgradeShip;
}

/**
 * What upgrading an escort of this class to {@link escortUpgradeShip}
 * costs (shïp EscUpgrdCost), or 0 when there is nothing to upgrade to.
 *
 * Never negative: a plug-in that authors a negative cost would otherwise
 * PAY the player to upgrade, on a path where the sim only ever checks
 * "can you afford it".
 */
export function escortUpgradeCost(ship: ShipData, priceMod?: number): number {
    if (ship.escortUpgradeShip === null) {
        return 0;
    }
    return Math.max(0, modifiedPrice(ship.escortUpgradeCost, priceMod));
}

/**
 * What selling a CAPTURED escort of this class pays (shïp EscSellValue),
 * with the Bible's own default applied: "If you input a number that's less
 * than or equal to zero here, Nova will default to 10% of the ship's
 * original cost."
 *
 * The default is taken on the ship's ORIGINAL cost — the Bible's word — so
 * it floors rather than rounds for the same reason modifiedPrice does: a
 * hull the player got for nothing must not sell for a credit.
 */
export function escortSellValue(ship: ShipData, priceMod?: number): number {
    if (ship.escortSellValue > 0) {
        return modifiedPrice(ship.escortSellValue, priceMod);
    }
    return Math.max(0, Math.floor(
        modifiedPrice(ship.price, priceMod) * ESCORT_SELL_DEFAULT_FRACTION));
}
