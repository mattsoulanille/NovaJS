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
 * of mission_logic.ts.
 */

/** Axxx / the abort button: run OnAbort, drop cargo, remove. */
export function abortMission(machinery: MissionMachineryContext,
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
        applyOutcomeReputation(machinery, mission, 'abort');
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
