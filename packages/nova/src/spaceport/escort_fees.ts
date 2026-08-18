import { ShipData } from 'novadatainterface/ship_data';
import { modifiedPrice } from './price_mod.js';

/**
 * ============================================================================
 * What an escort costs: the hiring fee, and the wage that follows it
 * ============================================================================
 *
 * One module so that every place that quotes, charges or DISPLAYS an escort's
 * price agrees: the bar's hire dialog (hire_escort.ts), the daily debit at a
 * date advance (mission_session.ts's advanceEntityDate), the player-info
 * dialog's "Expenses:" line (player_info.ts), and the escort hail dialog's
 * release/sell/upgrade prices. A second copy of `price / 10` anywhere is a
 * bug waiting to happen, because the player is shown one number and charged
 * another.
 */

/**
 * The one-time fee to hire an escort: 10% of the ship's price.
 * Matches the original's observed behavior (a 300,000 cr Thunderhead
 * hires for 30,000 cr); the exact rule is not in the Bible.
 *
 * The 10% is taken on the price AFTER the docked stellar's ränk PriceMod
 * (price_mod.ts) — hiring is buying a ship's services, so a rank that makes
 * a hull free here makes hiring its pilot free too. That is exactly what
 * Extra Outfits' Spica Shipyard is for: the four PriceMod-1 ranks its "Buy
 * Station" outfit grants (extra-outfits:168-171, gövt extra-outfits:302)
 * compound to 1e-6 percent, so every hull the station builds hires for 0 cr
 * because the player already paid to construct it.
 */
export function hirePrice(ship: ShipData, priceMod?: number): number {
    return Math.round(modifiedPrice(ship.price, priceMod) / 10);
}

/**
 * The WAGE an escort's pilot draws, per day, for as long as they fly with
 * the player: **10% of that escort's hire price** (Matthew's ruling), i.e.
 * 1% of the hull's price. A 320,000 cr Thunderhead hires for 32,000 cr and
 * then costs 3,200 cr a day.
 *
 * This is the number the player-info dialog's "Expenses: N credits per day"
 * line reports (p_properties/general.png) and the number a date advance
 * actually debits — both go through this function, via
 * daily_budget.ts's `dailyBudget`, so the quoted rate and the charge cannot
 * drift apart.
 *
 * NOT PriceMod-adjusted by default, and that is deliberate even though the
 * HIRE fee is. PriceMod is a discount at a particular stellar owned by a
 * particular government; a wage is drawn wherever the flock happens to be,
 * including deep space where no stellar's rules apply. Bending it by
 * whatever rock the player last docked at would make the same escort cost
 * different amounts on different days with nothing about the escort having
 * changed. The parameter exists so a caller that genuinely is quoting a
 * shop price (an upgrade quote, say) can pass one.
 *
 * ONE ARGUMENT, THE SHIP CLASS: an escort's fee follows its CURRENT hull, so
 * an escort upgraded to a bigger ship starts drawing the bigger wage with
 * nothing else to update.
 */
export function escortDailyFee(ship: ShipData, priceMod?: number): number {
    return Math.round(hirePrice(ship, priceMod) / 10);
}

/**
 * The whole flock's daily wage bill: {@link escortDailyFee} summed over the
 * escorts on the player's payroll (nova_plugin/player_escort.ts's
 * EscortPayrollComponent holds their ship-class ids).
 *
 * A ship class the data set cannot produce is skipped rather than guessed
 * at, exactly as the shops skip an unloadable hull — better to undercharge
 * than to invent a fee.
 */
export function escortPayrollFee(shipIds: Iterable<string>,
    getShip: (id: string) => ShipData | undefined): number {
    let total = 0;
    for (const id of shipIds) {
        const ship = getShip(id);
        if (ship) {
            total += escortDailyFee(ship);
        }
    }
    return total;
}
