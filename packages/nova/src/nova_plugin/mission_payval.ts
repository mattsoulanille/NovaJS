import { GovtData } from 'novadatainterface/govt_data';
import { MissionData } from 'novadatainterface/mission_data';
import { setStringPrefix } from './mission_ids.js';
import { MissionMachineryContext } from './mission_machinery.js';
import {
    addRecord, cleanRecords, compRewardDelta, PayValEffect,
} from './reputation.js';

/**
 * Spending a mïsn's PayVal and CompGovt/CompReward against the working
 * state: the one place the PayVal encodings are applied, and the outcome
 * reputation change. Split out of mission_logic.ts.
 */

/**
 * The gövt a mission's bare CompGovt / PayVal number names, resolved the
 * same way an AvailStel govt range resolves one (`rangeGovt`, and
 * stock-first {@link resolveNumberedResource} everywhere else): the
 * plug-in that WROTE the mission first — its own private govts live under
 * its prefix — then stock.
 *
 * THE FALLBACK IS WHAT MAKES AN OVERRIDE WORK. A plug-in that overrides a
 * stock mïsn keeps the stock id, so {@link setStringPrefix} answers with
 * the plug-in's writerPrefix while the gövt the number names is still
 * `nova:n`. Keyed on the writer alone, the reputation change landed on a
 * phantom `<plug>:n` record that no gövt backs — an entry the player-info
 * dialog cannot name and nothing else ever reads — and PayVal's
 * record-cleaning silently did nothing at all, because `cleanRecords`
 * returns early when the govt does not resolve.
 *
 * Returns the writer-prefixed id when NEITHER resolves, which is the
 * pre-existing behaviour for a number no loaded data set defines.
 */
function missionGovt(machinery: MissionMachineryContext,
    mission: MissionData, n: number):
    { id: string, data: GovtData | undefined } {
    const getGovt = machinery.offerContext().getGovt;
    const own = `${setStringPrefix(mission)}:${n}`;
    const ownData = getGovt(own);
    if (ownData) {
        return { id: own, data: ownData };
    }
    const stock = `nova:${n}`;
    const stockData = getGovt(stock);
    return stockData ? { id: stock, data: stockData }
        : { id: own, data: undefined };
}

/**
 * Applies a mission outcome's CompGovt/CompReward record change
 * (Bible: complete grants CompReward; failure costs half — "that govt
 * will take it personally"; abort costs 5x under mïsn flag 0x0040).
 */
export function applyOutcomeReputation(machinery: MissionMachineryContext,
    mission: MissionData, outcome: 'complete' | 'fail' | 'abort'): void {
    const { state } = machinery;
    if (!state.records || mission.compGovt < 128) {
        return;
    }
    const delta = compRewardDelta(mission.compReward, outcome,
        mission.flags.lose5xCompRewardOnAbort);
    if (delta === 0) {
        return;
    }
    const govt = missionGovt(machinery, mission, mission.compGovt);
    addRecord(state.records, govt.id, govt.data, delta);
}

/**
 * Applies one decoded mïsn PayVal to the working state, and returns the
 * credits PAID (for the notice's <PAY> and the popup's "payment" line) —
 * `undefined` for every encoding that pays nothing.
 *
 * THE ONE PLACE THE FOUR ENCODINGS ARE SPENT. The Bible gives PayVal five
 * readings (see decodePayVal) and only one of them is "hand the player
 * money"; the other three take money or clean a record. Completion, the
 * immediate auto-abort, and the deferred auto-abort's player-local half all
 * route through here so a mission that costs 2% of your cash costs it
 * wherever it is settled. Splitting the arithmetic out is what fixed the
 * auto-abort paths, which used to test `payVal > 0` and so silently
 * discarded every negative encoding — including the stock "Drop Bear" trap
 * (mïsn nova:609/610, PayVal -40002/-40005) and mïsn nova:731's 50% fine.
 *
 * `takeCredits` is the odd one out in WHEN it applies (mission start, not
 * completion), not in HOW, so callers decide whether it is theirs to spend;
 * the arithmetic still lives here. Both takes clamp at zero: EV Nova has no
 * debt.
 */
export function applyPayVal(machinery: MissionMachineryContext,
    mission: MissionData, pay: PayValEffect): number | undefined {
    const { state } = machinery;
    switch (pay.type) {
        case 'credits':
            state.credits.credits += pay.amount;
            return pay.amount;
        case 'takePercent':
            state.credits.credits -= Math.trunc(
                state.credits.credits * pay.percent / 100);
            return undefined;
        case 'takeCredits':
            state.credits.credits = Math.max(0,
                state.credits.credits - pay.amount);
            return undefined;
        case 'cleanRecord':
            if (state.records) {
                cleanRecords(state.records, pay.scope,
                    missionGovt(machinery, mission, pay.govtResourceId).data,
                    machinery.allGovts?.() ?? []);
            }
            return undefined;
        case 'none':
            return undefined;
    }
}
