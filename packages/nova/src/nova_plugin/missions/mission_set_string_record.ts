import * as t from 'io-ts';
import { World } from 'nova_ecs/world';
import {
    ActiveMission, findControlledEntity, Missions, MissionsComponent,
    PendingMissionNoticesComponent, PendingMissionNoticesType,
} from '../player/index.js';
import { applyInFlightSetString, SetStringEffectsType } from './mission_accept.js';
import { releaseAbortedMissionShips } from './mission_ship_release.js';

/**
 * ============================================================================
 * A mission's OnShipDone and an in-flight OnFailure, run AT ONCE
 * ============================================================================
 *
 * MEASURED (reference "OnShipDone and an in-flight OnFailure, read by a
 * person's hail (the SD / SF leftover), wave 48"): the original sets both
 * strings' bits in flight, the moment the special ships' goal is met and
 * the moment the mission fails ("Mission failed."): a përs whose hail
 * offers a mission only while the bit is set offered it seconds after
 * each event, having refused it a minute before. NovaJS used to run both
 * at the owner's next date advance (jump or landing).
 *
 * THE SHAPE is the one the other in-flight set strings use (an in-flight
 * abort, a deferred auto-abort, a stellar's OnDominate): the simulation
 * marks the moment — `shipDonePending` on the goal, `failed` on the
 * mission or its goal, both already shared state — and the OWNER's client
 * (display/mission_set_string_plugin.ts) resolves the string against a
 * detached copy of its pilot under the mïsn's writer prefix
 * (spaceport/ship_mission_accept.ts buildMissionSetString) and sends the
 * deltas back on a `missionSetString` input record, applied below on
 * every peer at the same tick. The sim cannot run a set string itself: it
 * never reads mission data.
 *
 * EXACTLY ONCE. The record pays a debt the sim itself recorded, against
 * the SENDER's own mission list: a shipDone only while the goal is
 * `shipDonePending` and not yet `onShipDoneRun` (the apply sets it), a
 * failure only while the mission is on the list and failed (the apply
 * removes it). A duplicate, a replay or a record about a mission the
 * sender does not hold is a no-op. The date advance is the fallback for a
 * record that never went out: it runs OnShipDone only without
 * `onShipDoneRun` (missions/mission_landing.ts runShipDoneIfPending) and
 * fails only a mission still on the list.
 *
 * ORDER. A goal that completed before the mission failed (a disable
 * target disabled, then destroyed: mission_ship_state.ts shipDied) owes
 * its OnShipDone FIRST, as the date advance runs them: a failure is not
 * owed while its OnShipDone is (failureOwed), and the client sends one
 * record at a time. A mission the sim marked for its deferred auto-abort
 * owes neither: that record runs its pending OnShipDone itself
 * (buildDeferredAutoAbort) and ends it.
 */

/** Which set string a `missionSetString` record pays. */
export const MissionSetStringKindType = t.union([
    t.literal('shipDone'), t.literal('failure'),
]);
export type MissionSetStringKind = t.TypeOf<typeof MissionSetStringKindType>;

/**
 * The `missionSetString` record: the mission, which of its strings, the
 * notices the string left for the next spaceport (the failure's 'failed'
 * event with its FailText, which the original shows "when you go to
 * ReturnStel", and whatever its own `Sxxx` / `Axxx` announced — exactly
 * what the date advance used to queue), and the string's DELTAS, resolved
 * on the owning client. The ShipDoneText's own event is never among the
 * notices: it stays with the display and the date advance. JSON-safe like
 * every record.
 */
export const MissionSetStringType = t.intersection([
    t.type({ missionId: t.string, kind: MissionSetStringKindType }),
    t.partial({ notices: PendingMissionNoticesType }),
    SetStringEffectsType,
]);
export type MissionSetString = t.TypeOf<typeof MissionSetStringType>;

/** The OnShipDone of `active` is owed: its goal completed in the sim and
 * the string has not run (see the module note). */
export function shipDoneOwed(active: ActiveMission): boolean {
    const objective = active.shipObjective;
    return !!objective?.shipDonePending && !objective.onShipDoneRun
        && !active.autoAbortPending;
}

/** The in-flight failure of `active` is owed: the sim marked it failed,
 * and its OnShipDone, if any, has been paid first. */
export function failureOwed(active: ActiveMission): boolean {
    return (!!active.failed || !!active.shipObjective?.failed)
        && !active.autoAbortPending && !shipDoneOwed(active);
}

/**
 * The next string the pilot owes, in the date advance's order: every
 * OnShipDone before any failure, each by mission id. Undefined when none.
 */
export function owedMissionSetString(missions: Missions):
    { kind: MissionSetStringKind, missionId: string } | undefined {
    const ids = [...missions.keys()].sort();
    const shipDone = ids.find(id => shipDoneOwed(missions.get(id)!));
    if (shipDone !== undefined) {
        return { kind: 'shipDone', missionId: shipDone };
    }
    const failure = ids.find(id => failureOwed(missions.get(id)!));
    return failure !== undefined
        ? { kind: 'failure', missionId: failure } : undefined;
}

/**
 * Applies a `missionSetString` record on every peer at the same tick:
 * the actor from `peerId` (never the record), the debt checked against
 * its own mission list (see the module note), then
 *
 *  shipDone  the goal marked `onShipDoneRun` (a new objective; the goal
 *            stays complete and `shipDonePending` for the date advance's
 *            text);
 *  failure   the mission's special ships released as an abort's
 *            deferred case releases them (all of them stay, ordinary
 *            ships now, until the owner leaves the system — what NovaJS
 *            showed between an in-flight failure and the landing before;
 *            a ShipBehav-1 escort leaves the owner's flock, GUESS), and
 *            the mission off the list;
 *
 * the notices queued for the next spaceport, and the string's own starts
 * and ends and deltas (applyInFlightSetString).
 *
 * Synchronous and free of randomness and wall-clock reads (the rollback
 * driver replays it).
 */
export function applyMissionSetString(world: World,
    peerId: string | undefined, record: MissionSetString): void {
    const controlled = findControlledEntity(world, peerId);
    if (!controlled) {
        return;
    }
    const player = controlled.entity;
    const missions = player.components.get(MissionsComponent);
    const active = missions?.get(record.missionId);
    if (!missions || !active) {
        return;
    }
    if (record.kind === 'shipDone') {
        if (!shipDoneOwed(active) || !active.shipObjective) {
            return;
        }
        missions.set(record.missionId, {
            ...active,
            shipObjective: { ...active.shipObjective, onShipDoneRun: true },
        });
    } else {
        if (!failureOwed(active)) {
            return;
        }
        releaseAbortedMissionShips(world, controlled.uuid, record.missionId,
            active.shipObjective, true);
        missions.delete(record.missionId);
    }
    if (record.notices?.length) {
        player.components.set(PendingMissionNoticesComponent, [
            ...player.components.get(PendingMissionNoticesComponent) ?? [],
            ...record.notices.map(notice => ({ ...notice })),
        ]);
    }
    applyInFlightSetString(world, controlled.uuid, player, record,
        `the ${record.kind === 'shipDone' ? 'OnShipDone' : 'OnFailure'} `
        + `of ${record.missionId}`);
}
