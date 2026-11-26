import { PlanetData } from 'novadatainterface/planet_data';
import { ShipData } from 'novadatainterface/ship_data';
import { dailyTribute } from '../nova_plugin/encounters/index.js';
import { RankLookup, rankSalaryBreakdown } from '../nova_plugin/ncb/index.js';
import { escortPayrollFee } from './escort_fees.js';

/**
 * ============================================================================
 * The player's daily books
 * ============================================================================
 *
 * ONE computation, used twice:
 *
 *  - `advanceEntityDate` (mission_session.ts) walks it a day at a time and
 *    settles the player's credits — every landing costs a day, every jump
 *    several (a landing's day without the escort wages, which are paid at
 *    the departure: escort_wages.ts).
 *  - The player-info dialog's General page prints it as the "Income:" /
 *    "Expenses:" lines under Energy Status (p_properties/general.png shows
 *    "Expenses: 3,300 credits per day").
 *
 * Sharing it is the whole point of the module. A dialog that quoted a rate
 * the date advance did not actually charge would be worse than no line at
 * all.
 *
 * WHAT IS IN THE BOOKS
 *
 *   income    ränk Salary, the positive ones ("The number of credits that
 *             the affiliated government will pay the player, per day"),
 *             each gated by its own SalaryCap; and the TRIBUTE of every
 *             stellar the pilot has dominated (#353: "Daily tribute payout
 *             can go in 'income' using the same system as ranks, ... but
 *             it should appear on the `p` menu"), its decoded Tribute
 *             field (encounters/tribute.ts's dailyTribute; reference
 *             "Tribute (R18), wave 39": every dominated stellar pays at
 *             every day's advance, wherever the pilot is). A LANDING's day
 *             pays it at the departure, as the escort wages are paid
 *             (MEASURED, wave 38: the spaceport still read the old balance,
 *             the Leave added the Tribute).
 *   expenses  the daily wage of every escort on the player's payroll
 *             (escort_fees.ts: 10% of that escort's hire price), PLUS the
 *             absolute value of any NEGATIVE ränk Salary — Extra Outfits'
 *             ränk 167 "Shipyard Expenses (1000 per day)" is exactly that.
 *
 * BOTH SIDES ARE RATES AT THE CURRENT BALANCE. SalaryCap makes income a
 * function of the player's cash, so the figure the dialog shows is "what
 * today would pay", not a promise about next week.
 */
export interface DailyBudget {
    /** Credits paid TO the player on a day that starts at this balance. */
    income: number;
    /** Credits owed BY the player on a day that starts at this balance. */
    expenses: number;
}

/** Everything the books are computed from. */
export interface DailyBudgetInputs {
    /** The player's active ränk ids. */
    ranks?: Iterable<string>;
    getRank: RankLookup;
    /**
     * Ship-class ids of the escorts on the player's payroll — the mirror
     * EscortPayrollSystem keeps on the player entity
     * (nova_plugin/player/player_escort.ts's EscortPayrollComponent).
     */
    escortShips?: Iterable<string>;
    /** Ship data for those ids; a miss contributes no fee (see escort_fees). */
    getShip?: (id: string) => ShipData | undefined;
    /** The spöb ids the pilot has dominated (DominatedComponent). */
    dominated?: Iterable<string>;
    /** Planet data for those ids; a miss pays no tribute. */
    getPlanet?: (id: string) => Pick<PlanetData, 'domination'> | undefined;
}

/**
 * The books for a day that STARTS at `credits`. Pure: the same inputs give
 * the same answer on every peer, which is what lets the charge below and the
 * dialog's text be the same number.
 */
export function dailyBudget(inputs: DailyBudgetInputs,
    credits: number): DailyBudget {
    const ranks = rankSalaryBreakdown(inputs.ranks, inputs.getRank, credits);
    const getShip = inputs.getShip;
    const escorts = getShip
        ? escortPayrollFee(inputs.escortShips ?? [], getShip) : 0;
    const getPlanet = inputs.getPlanet;
    const tribute = getPlanet ? dailyTribute(inputs.dominated, getPlanet) : 0;
    return {
        income: ranks.income + tribute,
        expenses: ranks.expenses + escorts,
    };
}

/**
 * Settles `days` of the books against a starting balance and returns the new
 * one, a day at a time so that SalaryCap is re-tested each morning (the cap
 * is stated against "the money the player can have", so a day's pay is
 * all-or-nothing and the order the ranks are summed in cannot matter).
 *
 * NEVER GOES NEGATIVE. The original's escort the player cannot pay DEFECTS
 * (reference "Escort wages (R12), wave 37"); that happens as the player
 * leaves a spaceport, where the landing day's wages are paid escort by
 * escort (escort_wages.ts). The days settled HERE are a jump's (and a
 * mission's DatePostInc): the escorts are not on hand to dismiss, so the
 * balance is clamped at zero and a player who runs dry in flight meets the
 * defection at the next departure (GUESS: wages in flight were not
 * measured). The clamp is the same rule every other credits-spending path
 * follows, and it cannot produce the negative balance the credits readout
 * has no way to render.
 */
export function settleDailyBudget(inputs: DailyBudgetInputs,
    credits: number, days: number): number {
    let balance = credits;
    for (let day = 0; day < days; day++) {
        const { income, expenses } = dailyBudget(inputs, balance);
        if (income === 0 && expenses === 0) {
            break; // Nothing here can change that on a later day.
        }
        balance = Math.max(0, balance + income - expenses);
    }
    return balance;
}
