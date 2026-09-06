import { MissionData } from 'novadatainterface/mission_data';
import { loadMissionCargo, unloadMissionCargo } from './mission_cargo.js';
import { setStringPrefix } from './mission_ids.js';
import { MissionMachineryContext } from './mission_machinery.js';
import { applyPayVal } from './mission_payval.js';
import { runMissionSetString } from './mission_set_strings.js';
import { objectiveAllowsCompletion } from './mission_ship_state.js';
import {
    abortMission, completeMission, failMission,
} from './mission_transitions.js';
import { ActiveMission } from './player_state_plugin.js';
import { decodePayVal } from './reputation.js';

/**
 * The date-advance and landing sweeps over the player's active missions:
 * pending OnShipDone, pending deferred auto-aborts, expired deadlines,
 * and landing processing (travel legs, cargo transfer, completion). Split
 * out of mission_logic.ts.
 */

/**
 * Runs a mission's OnShipDone (and queues its ShipDoneText event) if the
 * shared sim flagged its ship goal complete (shipDonePending). The Bible
 * runs OnShipDone the moment the goal completes; the set string mutates
 * control bits player-locally, so the earliest deterministic, owner-
 * driven point is the next date advance (jump or landing). Clears the
 * pending flag so it runs exactly once.
 *
 * THE TEXT IS NOT DEFERRED — only the set string is. The owner's DISPLAY
 * shows the ShipDoneText at the moment the goal completes, off the same
 * `shipDonePending` flag (display/mission_ship_done_plugin.ts), which is
 * where the original shows it. The event queued here is still the one the
 * landing popups render, so processInFlightMissions drops it when the
 * client reports having already shown that text
 * (spaceport/ship_done_shown.ts) — belt and braces for the case where it
 * never got the chance (a quit between the two moments).
 */
function runShipDoneIfPending(machinery: MissionMachineryContext,
    active: ActiveMission, mission: MissionData,
    outfits?: Map<string, number>): void {
    const objective = active.shipObjective;
    if (!objective?.shipDonePending) {
        return;
    }
    objective.shipDonePending = false;
    runMissionSetString(machinery, mission.onShipDone,
        setStringPrefix(mission), outfits);
    if (mission.shipDoneText) {
        machinery.state.events.push({
            missionId: mission.id,
            missionName: mission.name,
            type: 'shipDone',
            text: mission.shipDoneText,
            pict: mission.shipDonePict,
            specialShipName: active.shipName,
        });
    }
}

/**
 * Runs OnShipDone for every active mission whose ship goal just
 * completed (shipDonePending), appending any ShipDoneText events.
 * Called at each date advance (jump or landing) so OnShipDone fires at
 * the first player-local opportunity after the goal completes rather
 * than waiting for a landing. Returns how many ran.
 */
export function runPendingShipDone(machinery: MissionMachineryContext,
    outfits?: Map<string, number>): number {
    const { state } = machinery;
    let ran = 0;
    for (const active of [...state.missions.values()]) {
        // The loop iterates a snapshot; an earlier mission's OnShipDone
        // can abort/fail a later one via an Axxx/Fxxx set string, removing
        // it from state.missions mid-loop (abort/fail leave shipDonePending
        // untouched). Skip any mission that is no longer active so a dead
        // mission's OnShipDone (and shipDone event) never runs, mirroring
        // the guard failExpiredMissions gets for free from failMission's
        // early return. See mission_logic_test.ts (self/sibling abort).
        if (!state.missions.has(active.id)) {
            continue;
        }
        if (!active.shipObjective?.shipDonePending) {
            continue;
        }
        const mission = machinery.getMission(active.id);
        if (!mission) {
            continue;
        }
        runShipDoneIfPending(machinery, active, mission, outfits);
        ran++;
    }
    return ran;
}

/**
 * Runs the PLAYER-LOCAL half of a deferred auto-abort (mïsn Flags 0x0001
 * on a board/rescue-goal mission — see deferredAutoAbort).
 *
 * The simulation already did the parts it owns, the tick the owner
 * boarded the special ship: paying mïsn Flags2 0x0002's Pay, taking
 * Flags 0x0008's 100 units of fuel, and lifting the rescue target's
 * disable so it flies off (MissionShipTrackSystem's rescueBoarded). What
 * is left needs the mission UNIVERSE, which the sim cannot see: the
 * OnAbort set string, dropping the mission from the list, and its notice.
 * That is exactly the split `shipDonePending` already uses, so this runs
 * beside runPendingShipDone at every date advance.
 *
 * Reusing `abortMission` rather than open-coding it is what keeps the
 * deferred case honest: the Bible calls this an ABORT ("the mission will
 * auto-abort after the special ship is boarded"), so it must run OnAbort,
 * apply the abort reputation, and unload mission cargo like any other.
 * Returns how many ran.
 */
export function runPendingAutoAborts(machinery: MissionMachineryContext,
    outfits?: Map<string, number>): number {
    const { state } = machinery;
    let ran = 0;
    for (const active of [...state.missions.values()]) {
        // The snapshot can go stale under an earlier mission's set string
        // (the same hazard runPendingShipDone documents).
        if (!state.missions.has(active.id) || !active.autoAbortPending) {
            continue;
        }
        // The half of mïsn Flags2 0x0002's Pay that needs the government
        // table: PayVal's record-cleaning encodings. The sim already
        // settled the two arithmetic ones from the frozen
        // autoAbortPay/autoAbortTakePercent (autoAbortPayEffects); this
        // one is re-decoded from the mission data, which is exactly what
        // this side of the split has and the sim does not.
        const mission = machinery.getMission(active.id);
        if (mission?.flags.applyPayOnAutoAbort) {
            const pay = decodePayVal(mission.payVal);
            if (pay.type === 'cleanRecord') {
                applyPayVal(machinery, mission, pay);
            }
        }
        abortMission(machinery, active.id, outfits);
        ran++;
    }
    return ran;
}

/**
 * Fails every active mission whose deadline has passed as of
 * `currentDay`, or which the shared sim marked failed (`active.failed`).
 * Runs OnFailure and appends a failure event for each — the same as a
 * landing-time deadline failure, but callable at every date advance
 * (jump or landing) so a deadline that expires in flight fails the
 * moment it passes rather than at the next landing. Returns the number
 * of missions failed. Missions completing at their destination are left
 * to processLanding.
 */
export function failExpiredMissions(machinery: MissionMachineryContext,
    currentDay: number, outfits?: Map<string, number>): number {
    const { state } = machinery;
    let failed = 0;
    for (const active of [...state.missions.values()]) {
        const expired = active.deadlineDay !== null
            && currentDay > active.deadlineDay;
        if (expired || active.failed) {
            failMission(machinery, active.id, outfits);
            failed++;
        }
    }
    return failed;
}

/**
 * Processes a landing at `planetId` for every active mission:
 * deadline failures, travel-leg cargo transfer, and completion at the
 * return stellar (paying and running OnSuccess). Events are appended
 * to the working state for the UI.
 */
export function processLanding(machinery: MissionMachineryContext,
    planetId: string, currentDay: number,
    outfits?: Map<string, number>): void {
    const { state } = machinery;
    // Landing at `planetId` also satisfies an objective set to a duplicate
    // stellar (same name + coordinates), per the Bible. Threaded via
    // sameStellar so pure callers without topology keep exact-id matching.
    const landedAt = (destId: string | null): boolean =>
        destId !== null && (destId === planetId
            || (machinery.sameStellar?.(destId, planetId) ?? false));
    for (const active of [...state.missions.values()]) {
        // The loop iterates a snapshot; an earlier mission's OnSuccess (or
        // OnShipDone/OnAbort) can abort/fail/complete a later one via an
        // Axxx/Fxxx set string, removing it from state.missions mid-loop.
        // Skip any mission that is no longer active so we never re-process
        // (and re-pay) it.
        if (!state.missions.has(active.id)) {
            continue;
        }
        const mission = machinery.getMission(active.id);
        if (!mission) {
            console.warn(`Active mission ${active.id} has no data; skipping.`);
            continue;
        }
        if (active.deadlineDay !== null && currentDay > active.deadlineDay) {
            failMission(machinery, active.id, outfits);
            continue;
        }
        if (active.failed) {
            // The shared sim marked the mission failed (the owner was
            // disabled or destroyed under Flags2 0x0004).
            failMission(machinery, active.id, outfits);
            continue;
        }
        const objective = active.shipObjective;
        if (objective?.failed) {
            // The ship goal became unachievable (an escort died, a
            // disable target was destroyed).
            failMission(machinery, active.id, outfits);
            continue;
        }
        // OnShipDone normally runs at the previous date advance (jump or
        // landing) the moment the goal completed; this catches the case
        // where the goal completed at this very landing's date advance.
        runShipDoneIfPending(machinery, active, mission, outfits);
        // OnShipDone's set string can abort/fail THIS mission (an Axxx/Fxxx
        // naming itself, which the abort/fail hooks allow since it is still
        // active at that point). Re-check membership before falling through
        // to completion so a self-aborted mission isn't also completed —
        // which would pay PayVal and push a 'completed' event for a mission
        // that was just aborted. See mission_logic_test.ts (self-abort).
        if (!state.missions.has(active.id)) {
            continue;
        }
        if (landedAt(active.travelPlanet) && !active.travelDone) {
            let transferred = true;
            if (mission.pickupMode === 1) {
                transferred = loadMissionCargo(state, active);
                if (transferred && mission.loadCargoText) {
                    // The LoadCargText dësc, as a landing popup — without
                    // it, picking up the cargo is silent and the player
                    // can't tell the stop registered.
                    state.events.push({
                        missionId: mission.id,
                        missionName: mission.name,
                        type: 'cargoLoaded',
                        text: mission.loadCargoText,
                        pict: mission.loadCargoPict,
                        specialShipName: active.shipName,
                        stop: 'travel',
                    });
                }
            }
            if (mission.dropOffMode === 0) {
                unloadMissionCargo(state, active);
                if (mission.dropOffCargoText) {
                    // The DropCargText dësc (e.g. the Kontik probe's desc
                    // 8781) — the original shows it when the cargo is
                    // dropped at the travel stellar; landing "silently
                    // working" reads as the mission being stuck.
                    state.events.push({
                        missionId: mission.id,
                        missionName: mission.name,
                        type: 'cargoDropped',
                        text: mission.dropOffCargoText,
                        pict: mission.dropOffCargoPict,
                        specialShipName: active.shipName,
                        stop: 'travel',
                    });
                }
            }
            if (transferred) {
                active.travelDone = true;
            }
        }
        // A mission with no return stellar completes at its travel
        // stellar; with neither, it can only end by script or abort.
        const completionPlanet = active.returnPlanet ?? active.travelPlanet;
        const travelSatisfied = active.travelPlanet === null
            || active.travelDone;
        const goalSatisfied = !objective
            || objectiveAllowsCompletion(objective);
        if (landedAt(completionPlanet) && travelSatisfied
            && goalSatisfied) {
            completeMission(machinery, active, mission, outfits);
        }
    }
}
