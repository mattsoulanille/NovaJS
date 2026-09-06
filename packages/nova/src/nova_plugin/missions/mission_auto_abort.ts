import { MissionData } from 'novadatainterface/mission_data';
import { GOAL_BOARD, GOAL_RESCUE } from '../player/index.js';
import { decodePayVal } from '../reputation/index.js';

/**
 * mïsn Flags 0x0001 auto-abort: the fuel cost, whether the abort is
 * deferred to the boarding of the special ship, and the decoded Pay
 * effects frozen for the sim when it is. Split out of mission_logic.ts.
 */

/**
 * mïsn Flags 0x0008: "Mission takes away 100 units of fuel upon
 * auto-abort. (mission won't be offered if player has less than 100 units
 * of fuel)". The figure is the Bible's, not a tunable.
 */
export const AUTO_ABORT_FUEL_COST = 100;

/**
 * Whether a mission's auto-abort (mïsn Flags 0x0001) is DEFERRED to the
 * boarding of its special ship rather than firing at accept.
 *
 * The Bible, verbatim: "If the mission is one in which a special ship
 * replaces a përs ship at mission start (such as for a 'rescue disabled
 * ship' mission) and the SpecialShipGoal is 2 or 5 (board or rescue) the
 * mission will auto-abort after the special ship is boarded."
 *
 * The checkable half of that sentence is the goal, and it is the half
 * that matters: the same paragraph already requires special ships for an
 * auto-abort to trigger at all ("there must be special ships associated
 * with the mission to trigger the auto-abort"), and a board/rescue goal
 * is only satisfiable by boarding a ship that exists. The përs-
 * replacement half is not re-checked here because acceptOffer does not
 * know which përs offered the mission — and a board/rescue auto-abort
 * mission with no përs behind it would otherwise abort instantly, before
 * its own goal could ever be met.
 *
 * A deferred mission therefore BECOMES ACTIVE like any other, so its
 * special ship spawns and can be found; MissionShipTrackSystem fires the
 * abort when the owner boards it.
 */
export function deferredAutoAbort(mission: MissionData): boolean {
    return mission.flags.autoAbort && mission.shipCount > 0
        && (mission.shipGoal === GOAL_BOARD
            || mission.shipGoal === GOAL_RESCUE);
}

/**
 * The DECODED mïsn Flags2 0x0002 ("Apply mission Pay on auto-abort")
 * effects a DEFERRED auto-abort freezes onto its ActiveMission, for the
 * simulation to apply the tick the special ship is boarded.
 *
 * The decoded effect is frozen, never the raw PayVal, for the same reason
 * `failIfPlayerDisabledOrDestroyed` is frozen: the simulation never reads
 * mission game data, so it cannot decode a PayVal itself — and the old
 * `payVal > 0 ? payVal : undefined` threw away every negative encoding on
 * the way past. Both fields here are pure arithmetic on the synced
 * CreditsComponent, which is why they are the sim's half at all.
 *
 * NOT frozen, deliberately: `cleanRecord` (PayVal -10128 and friends),
 * which needs the government table, and `takeCredits`, which the Bible
 * applies at mission START — a deferred auto-abort mission really does
 * start, so acceptOffer's normal takeCredits already spent it. See
 * runPendingAutoAborts for the record-cleaning half.
 */
export function autoAbortPayEffects(mission: MissionData):
    { autoAbortPay?: number, autoAbortTakePercent?: number } {
    if (!mission.flags.applyPayOnAutoAbort) {
        return {};
    }
    const pay = decodePayVal(mission.payVal);
    if (pay.type === 'credits') {
        return { autoAbortPay: pay.amount };
    }
    if (pay.type === 'takePercent') {
        return { autoAbortTakePercent: pay.percent };
    }
    return {};
}
