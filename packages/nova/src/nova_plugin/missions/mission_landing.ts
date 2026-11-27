import { MissionData } from 'novadatainterface/mission_data';
import { loadMissionCargo, unloadMissionCargo } from './mission_cargo.js';
import { setStringPrefix } from './mission_ids.js';
import { MissionMachineryContext } from './mission_machinery.js';
import { applyPayVal } from './mission_payval.js';
import { runMissionSetString } from './mission_set_strings.js';
import { objectiveAllowsCompletion } from '../player/index.js';
import {
    autoAbortMission, completeMission, failMission, simFailOutcome,
} from './mission_transitions.js';
import { ActiveMission } from '../player/index.js';
import { decodePayVal } from '../reputation/index.js';

/**
 * The date-advance and landing sweeps over the player's active missions:
 * pending OnShipDone, pending deferred auto-aborts, expired deadlines,
 * and landing processing (travel legs, cargo transfer, completion). Split
 * out of mission_logic.ts.
 */

/**
 * Settles a mission whose ship goal the shared sim flagged complete
 * (shipDonePending): runs its OnShipDone unless that already ran in
 * flight (`onShipDoneRun`, the `missionSetString` record — the usual
 * case, see runShipDoneSetString), and queues its ShipDoneText event.
 * Clears the pending flag, so it settles exactly once.
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
    if (!objective.onShipDoneRun) {
        runMissionSetString(machinery, mission.onShipDone,
            setStringPrefix(mission), outfits);
    }
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
 * Settles every active mission whose ship goal just completed
 * (shipDonePending; runShipDoneIfPending), appending any ShipDoneText
 * events. Called at each date advance (jump or landing): the fallback for
 * an OnShipDone whose in-flight record never went out. Returns how many
 * settled.
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
 * The OnShipDone of `missionId` alone, IN FLIGHT, on the owner's detached
 * copy (spaceport/ship_mission_accept.ts buildMissionSetString): runs the
 * set string when the sim has flagged the goal complete
 * (`shipDonePending`) and it has not run yet (`onShipDoneRun`), and marks
 * it run on the copy. Neither clears the pending flag nor queues the
 * ShipDoneText event: the text is the display's at this moment and the
 * date advance's later (runShipDoneIfPending), as before. Returns whether
 * it ran.
 *
 * MEASURED (reference "OnShipDone and an in-flight OnFailure, read by a
 * person's hail (the SD / SF leftover), wave 48"): a përs whose hail
 * offers a mission only while OnShipDone's bit is set offered it seconds
 * after the special ship died, having refused it a minute before.
 */
export function runShipDoneSetString(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>): boolean {
    const active = machinery.state.missions.get(missionId);
    const objective = active?.shipObjective;
    if (!active || !objective?.shipDonePending || objective.onShipDoneRun) {
        return false;
    }
    // Replaced, not edited: the copy's objective may be shared with the
    // mirror it was detached from.
    machinery.state.missions.set(missionId, {
        ...active, shipObjective: { ...objective, onShipDoneRun: true },
    });
    const mission = machinery.getMission(missionId);
    if (mission) {
        runMissionSetString(machinery, mission.onShipDone,
            setStringPrefix(mission), outfits);
    }
    return true;
}

/**
 * Fails `missionId` IN FLIGHT, on the owner's detached copy, the moment
 * the shared sim has marked it failed (`failed`, or its ship goal's
 * `failed`): the very failMission the date advance would run — OnFailure,
 * the CompReward change, the mission cargo unloaded, the 'failed' event —
 * with the cause the landing would give it. Returns whether it failed.
 *
 * MEASURED for a ship goal made unachievable (reference "OnShipDone and
 * an in-flight OnFailure ..., wave 48": a hail gated on OnFailure's bit
 * offered seconds after "Mission failed."); the sim's other failures
 * (the owner disabled or destroyed, plundered, scanned) are run at once
 * too, a GUESS that they fail the same way.
 */
export function failMissionInFlight(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>): boolean {
    const active = machinery.state.missions.get(missionId);
    if (!active || !(active.failed || active.shipObjective?.failed)) {
        return false;
    }
    failMission(machinery, missionId, outfits, 0,
        active.failed ? simFailOutcome(active) : 'fail');
    return true;
}

/**
 * Runs the PLAYER-LOCAL half of one deferred auto-abort (mïsn Flags 0x0001
 * on a board/rescue-goal mission — see deferredAutoAbort): `missionId`'s,
 * which the sim marked `autoAbortPending` when its owner boarded the
 * special ship. A no-op (false) when that mission is not active or not
 * pending.
 *
 * The simulation already did the parts it owns, the tick the owner
 * boarded the special ship: paying mïsn Flags2 0x0002's Pay, taking
 * Flags 0x0008's 100 units of fuel, and lifting the rescue target's
 * disable (MissionShipTrackSystem's rescueBoarded). What is left needs
 * the mission UNIVERSE, which the sim cannot see: the OnAbort set string,
 * dropping the mission from the list, its DatePostInc, and its notice.
 *
 * WHEN. At the board itself, in flight: the owner's display sees the
 * pending flag and sends the result as an in-flight abort record
 * (spaceport/ship_mission_accept.ts buildDeferredAutoAbort, display/
 * mission_info_plugin.ts). MEASURED (reference "The deferred (përs)
 * auto-abort (R16), wave 43"): one board ended the mission at once in
 * flight ("You have no active missions." seconds later, no landing or
 * jump) and moved the date by its DatePostInc there (June 28th -> July
 * 5th). runPendingAutoAborts is the fallback at the next date advance,
 * for a record that never went out (the client closed in between).
 *
 * Reusing the abort transition rather than open-coding it is what keeps
 * the deferred case honest: the Bible calls this an ABORT ("the mission
 * will auto-abort after the special ship is boarded"), so it must run
 * OnAbort and unload mission cargo like any other. It is an AUTO-abort,
 * though, so it goes through `autoAbortMission`, which leaves out the
 * player-abort CompReward reversal (Flags 0x0040) exactly as the
 * immediate auto-abort in acceptOffer does (#320; see autoAbortMission).
 * DatePostInc ("after successful completion or auto-aborting", the Bible)
 * comes with it, as it does with the immediate auto-abort (reference
 * "DatePostInc on an immediate auto-abort (R16), wave 41").
 */
export function runDeferredAutoAbort(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>): boolean {
    const active = machinery.state.missions.get(missionId);
    if (!active?.autoAbortPending) {
        return false;
    }
    // The half of mïsn Flags2 0x0002's Pay that needs the government
    // table: PayVal's record-cleaning encodings. The sim already settled
    // the two arithmetic ones from the frozen
    // autoAbortPay/autoAbortTakePercent (autoAbortPayEffects); this one is
    // re-decoded from the mission data, which is exactly what this side
    // of the split has and the sim does not.
    const mission = machinery.getMission(missionId);
    if (mission?.flags.applyPayOnAutoAbort) {
        const pay = decodePayVal(mission.payVal);
        if (pay.type === 'cleanRecord') {
            applyPayVal(machinery, mission, pay);
        }
    }
    if (mission) {
        machinery.state.dateAdvance += Math.max(0, mission.datePostInc);
    }
    autoAbortMission(machinery, missionId, outfits);
    return true;
}

/**
 * Runs runDeferredAutoAbort for every active mission still marked
 * `autoAbortPending` (beside runPendingShipDone at every date advance):
 * the fallback for a deferred auto-abort whose in-flight record never
 * went out. Returns how many ran.
 */
export function runPendingAutoAborts(machinery: MissionMachineryContext,
    outfits?: Map<string, number>): number {
    let ran = 0;
    for (const id of [...machinery.state.missions.keys()]) {
        // The snapshot can go stale under an earlier mission's set string
        // (the same hazard runPendingShipDone documents);
        // runDeferredAutoAbort skips a mission that is gone.
        if (runDeferredAutoAbort(machinery, id, outfits)) {
            ran++;
        }
    }
    return ran;
}

/**
 * Runs the OnAbort of every immediate auto-abort (mïsn Flags 0x0001) whose
 * special ships were queued at a docked accept and are about to be
 * created: the lift-off, where the original aborts such a mission
 * (reference #320 item 3, wave 10; see acceptOffer). Each batch's
 * `onAbortPending` is cleared BEFORE its set string runs, so it runs once
 * however the set string recurses; the batch itself stays for
 * buildMissionShipSpawns to spawn. A batch queued by the set strings run
 * here (an Sxxx starting another such mission) aborts at this same
 * lift-off. Its DatePostInc comes here too (reference "DatePostInc on an
 * immediate auto-abort (R16), wave 41"). Nothing else of the abort is
 * deferred: OnAccept, the 0x0002 Pay, the accept's own day and the notice
 * all happened at accept. Returns how many ran.
 */
export function runQueuedAutoAbortOnAborts(machinery: MissionMachineryContext,
    outfits?: Map<string, number>): number {
    const batches = machinery.state.autoAbortShips;
    if (!batches) {
        return 0;
    }
    let ran = 0;
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        if (!batch.onAbortPending) {
            continue;
        }
        // Replaced, not edited: the entry may be shared with the entity's
        // component (see PLAYER_STATE_COMPONENTS).
        const { onAbortPending: _ran, ...rest } = batch;
        batches[i] = rest;
        const mission = machinery.getMission(batch.missionId);
        if (!mission) {
            console.warn(`Auto-abort ${batch.missionId} has no data; `
                + 'its OnAbort is skipped.');
            continue;
        }
        runMissionSetString(machinery, mission.onAbort,
            setStringPrefix(mission), outfits);
        // ...and its DatePostInc, held back at the accept (reference
        // "DatePostInc on an immediate auto-abort (R16), wave 41").
        machinery.state.dateAdvance += Math.max(0, mission.datePostInc);
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
            // A mission the sim already failed is not a timeout, even if
            // its deadline has passed since.
            failMission(machinery, active.id, outfits, 0,
                active.failed ? simFailOutcome(active) : 'timeout');
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
            // A TimeLimit failure changes no record (failMission's
            // 'timeout'), unless the sim had already failed it for
            // another reason.
            failMission(machinery, active.id, outfits, 0,
                active.failed ? simFailOutcome(active)
                    : active.shipObjective?.failed ? 'fail' : 'timeout');
            continue;
        }
        if (active.failed) {
            // The shared sim marked the mission failed (the owner was
            // disabled or destroyed under Flags2 0x0004, boarded by
            // pirates under Flags 0x8000, or scanned under Flags 0x0020:
            // ActiveMission.failCause).
            failMission(machinery, active.id, outfits, 0,
                simFailOutcome(active));
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
