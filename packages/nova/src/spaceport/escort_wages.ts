import { drawsEscortWage } from '../nova_plugin/escorts/index.js';
import { ShipDataComponent } from '../nova_plugin/ship/index.js';
import { EscortDealEntry, wingOf } from './escort_deals.js';
import { escortDailyFee } from './escort_fees.js';

/**
 * ============================================================================
 * The landing day's escort wages — paid AT LIFT-OFF, or the escort defects
 * ============================================================================
 *
 * Reference "Escort wages (R12), wave 37" (docs/reference_experiments.md):
 *
 *  1. The daily wage is 1% of the hull's Cost (escort_fees.ts's
 *     escortDailyFee), as NovaJS already charged.
 *  2. The landing day's wage is charged when the player LEAVES the
 *     spaceport: in every run the spaceport showed the credits unchanged
 *     after the landing, and the wage came off at the Leave press. So the
 *     landing's date advance settles the books WITHOUT the escort wages
 *     (mission_session.ts's `escortWages: false`) and this settles them as
 *     the player departs, from Spaceport.leave, after the queued escort
 *     deals (a sale's proceeds can pay a wage; a sold escort is gone).
 *  3. An escort the player cannot pay DEFECTS: with 500 credits against
 *     wages of 1,000 + 100, the 1,000-a-day escort left ("Due to lack of
 *     pay, one of your escorts has defected.", one Okay) and the 100-a-day
 *     one was paid (500 -> 400) and stayed.
 *
 * THE ORDER IS THE ROSTER'S (GUESS, the section's own): the escorts are
 * paid in turn, and each one the remaining credits cannot cover defects,
 * so a cheaper one further down can still be paid. Which one goes first
 * when several are unaffordable was not measured; the roster's order (the
 * order the escorts landed in) is stable for a client session and reads
 * no clock or PRNG. The measured run is reproduced either way (its roster
 * held the 1,000 escort first).
 *
 * A DEFECTED ESCORT IS SIMPLY GONE (the pulled pilot no longer held it):
 * it is spliced off the landed roster, which is the only thing that would
 * put it back in the world, together with its own wing (as a sale takes a
 * carrier's fighters: they were the player's only through it). Neither
 * hostile nor left behind in the system: unmeasured, and the reference saw
 * nothing of it after the message.
 *
 * WHO IS PAID: the roster's wage-drawing escorts (drawsEscortWage: hired,
 * not a mission ship, not a bay fighter). An escort hired at the bar THIS
 * visit is not on the roster yet (it spawns at lift-off) and draws nothing
 * for the day it was hired (GUESS; it was not with the player that day). An
 * escort whose hold a venue still has checked out is skipped, paid and
 * kept (never at Leave: no venue is open then).
 *
 * Days in FLIGHT (a jump's date advance) are still charged a day at a
 * time by settleDailyBudget, clamped at zero as before; a player who runs
 * dry in hyperspace meets the defection at the next departure.
 */

/** One escort that could not be paid and left. */
export interface DefectedEscort {
    uuid: string;
    /** Its ship class. */
    shipId: string | undefined;
    /** The day's wage it was owed. */
    wage: number;
    /** Its own wing, dropped from the roster with it. */
    withCarrier: string[];
}

export interface EscortWageSettlement {
    /** Credits paid out in wages (>= 0). */
    paid: number;
    defected: DefectedEscort[];
}

/**
 * Pays one day's wage to each of `player`'s wage-drawing escorts on
 * `roster`, in roster order, from `credits`; MUTATES the roster, splicing
 * out every escort the running balance cannot cover (and its wing). Pure
 * otherwise: no clock, no PRNG.
 */
export function settleEscortWages(roster: EscortDealEntry[], player: string,
    credits: number,
    holdOpen: (uuid: string) => boolean = () => false): EscortWageSettlement {
    const settlement: EscortWageSettlement = { paid: 0, defected: [] };
    let balance = credits;
    for (const entry of [...roster]) {
        if (entry.player !== player || !roster.includes(entry)
            || !drawsEscortWage(entry.entity, player)) {
            continue;
        }
        const shipData = entry.entity.components.get(ShipDataComponent);
        if (!shipData) {
            continue; // Nothing to price it by: no wage, as escort_fees.
        }
        const wage = escortDailyFee(shipData);
        if (wage <= balance) {
            balance -= wage;
            settlement.paid += wage;
            continue;
        }
        const wing = wingOf(roster, entry.uuid);
        if (holdOpen(entry.uuid) || [...wing].some(holdOpen)) {
            continue; // Frozen: never spliced under an open hold.
        }
        for (let i = roster.length - 1; i >= 0; i--) {
            if (roster[i] === entry || wing.has(roster[i].uuid)) {
                roster.splice(i, 1);
            }
        }
        settlement.defected.push({
            uuid: entry.uuid, shipId: shipData.id, wage,
            withCarrier: [...wing].sort(),
        });
    }
    return settlement;
}

/** Stock STR# 2002 0-based 301, verbatim. */
export const ESCORT_DEFECTED_MESSAGE =
    'Due to lack of pay, one of your escorts has defected.';
/** Stock STR# 2002 0-based 302, verbatim: the plural the original keeps
 * beside it (GUESS: one dialog for several defections, not one each). */
export const ESCORTS_DEFECTED_MESSAGE =
    'Due to lack of pay, some of your escorts have defected.';

/** The departure dialog for a wage settlement; undefined when nobody
 * defected (the wages alone are not announced). */
export function escortWageReport(settlement: EscortWageSettlement):
    string | undefined {
    const count = settlement.defected.length;
    if (count === 0) {
        return undefined;
    }
    return count === 1 ? ESCORT_DEFECTED_MESSAGE : ESCORTS_DEFECTED_MESSAGE;
}
