import { MissionData } from 'novadatainterface/mission_data';
import { unloadMissionCargo } from './mission_cargo.js';
import { setStringPrefix } from './mission_ids.js';
import { MissionMachineryContext } from './mission_machinery.js';
import { applyOutcomeReputation, applyPayVal } from './mission_payval.js';
import { runMissionSetString } from './mission_set_strings.js';
import { ActiveMission } from '../player/index.js';
import { decodePayVal } from '../reputation/index.js';

/**
 * How an active mission ends: abort (Axxx / the abort button), fail (Fxxx
 * / deadline / sim-flagged) and completion at its destination. Split out
 * of mission_logic.ts. The Axxx/Fxxx operators are INJECTED through the
 * machinery (MissionMachineryContext.missionOperators) rather than
 * imported back from mission_set_strings: importing them here made the
 * missions modules import each other in a cycle (#266).
 */

/** Axxx / the abort button: run OnAbort, drop cargo, remove. */
export function abortMission(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>, depth = 0): void {
    endByAbort(machinery, missionId, outfits, depth, true);
}

/**
 * A DEFERRED auto-abort (mïsn Flags 0x0001 on a board/rescue goal — see
 * deferredAutoAbort) ending the mission: everything {@link abortMission}
 * does EXCEPT the CompReward abort reversal (Flags 0x0040).
 *
 * The one rule for both kinds of auto-abort (#320): an auto-abort is the
 * mission's own scripted end, not the player walking out on it. So it runs
 * what the Bible attaches to the auto-abort itself — OnAbort ("Any control
 * bits pointed to by the mission's OnAbort fields will be automatically
 * set when the mission aborts", Flags 0x0001), the Pay under Flags2 0x0002
 * ("Apply mission Pay on auto-abort"), the fuel under Flags 0x0008 — and
 * never the 0x0040 "-5x CompReward reversal on abort", which punishes an
 * abort the PLAYER chose (OnAbort: "evaluated when the mission is aborted
 * by the player"). The immediate auto-abort in acceptOffer already worked
 * that way; this path used to reuse abortMission whole and so applied the
 * reversal, the asymmetry #320 asked about. The maintainer's ruling there:
 * "An auto-abort can still pay if the mission says it should" — the
 * auto-abort is not a penalty in itself.
 */
export function autoAbortMission(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>, depth = 0): void {
    endByAbort(machinery, missionId, outfits, depth, false);
}

function endByAbort(machinery: MissionMachineryContext,
    missionId: string, outfits: Map<string, number> | undefined,
    depth: number, applyAbortReversal: boolean): void {
    const { state } = machinery;
    const active = state.missions.get(missionId);
    if (!active) {
        return;
    }
    state.missions.delete(missionId);
    unloadMissionCargo(state, active);
    const mission = machinery.getMission(missionId);
    if (mission) {
        if (applyAbortReversal) {
            applyOutcomeReputation(machinery, mission, 'abort');
        }
        runMissionSetString(machinery, mission.onAbort,
            setStringPrefix(mission), outfits, depth);
    }
    state.events.push({
        missionId,
        missionName: mission?.name ?? missionId,
        type: 'aborted',
        text: '',
    });
}

/** Fxxx / deadline passed: run OnFailure, drop cargo, remove. */
export function failMission(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>, depth = 0): void {
    const { state } = machinery;
    const active = state.missions.get(missionId);
    if (!active) {
        return;
    }
    state.missions.delete(missionId);
    unloadMissionCargo(state, active);
    const mission = machinery.getMission(missionId);
    if (mission) {
        applyOutcomeReputation(machinery, mission, 'fail');
        runMissionSetString(machinery, mission.onFailure,
            setStringPrefix(mission), outfits, depth);
    }
    state.events.push({
        missionId,
        missionName: mission?.name ?? missionId,
        type: 'failed',
        text: mission?.failText ?? '',
        pict: mission?.failPict ?? null,
        specialShipName: active.shipName,
    });
}

export function completeMission(machinery: MissionMachineryContext,
    active: ActiveMission, mission: MissionData,
    outfits?: Map<string, number>): void {
    const { state } = machinery;
    state.missions.delete(active.id);
    // DropOffMode 1: "Drop off at mission end (ReturnStel)". The original
    // shows the DropCargText here, BEFORE the CompText — and it does so
    // whether or not the mission carries any cargo: 52 stock missions
    // (e.g. mïsn nova:167/172, the Polaris martial-arts pair) have no
    // cargo, DropOffMode 1 and a DropCargText, and land to two boxes in a
    // row. Per the Bible's note the drop only happens if the cargo was
    // picked up (vacuously true with no cargo); the ship-goal condition
    // is already met by the time completion is reached.
    if (mission.dropOffMode === 1 && mission.dropOffCargoText
        && (active.cargoQty <= 0 || active.cargoLoaded)) {
        state.events.push({
            missionId: mission.id,
            missionName: mission.name,
            type: 'cargoDropped',
            text: mission.dropOffCargoText,
            pict: mission.dropOffCargoPict,
            specialShipName: active.shipName,
            stop: 'return',
        });
    }
    unloadMissionCargo(state, active);
    // PayVal: credits, record cleaning, or cash removal (the Bible's
    // negative encodings; takeCredits already applied at accept, so it is
    // the one encoding completion does NOT spend).
    const pay = decodePayVal(mission.payVal);
    const payment = pay.type === 'takeCredits' ? undefined
        : applyPayVal(machinery, mission, pay);
    applyOutcomeReputation(machinery, mission, 'complete');
    state.dateAdvance += Math.max(0, mission.datePostInc);
    runMissionSetString(machinery, mission.onSuccess,
        setStringPrefix(mission), outfits);
    state.events.push({
        missionId: mission.id,
        missionName: mission.name,
        type: 'completed',
        text: mission.completionText,
        pict: mission.completionPict,
        payment,
        specialShipName: active.shipName,
    });
}
