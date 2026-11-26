import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { FiringGroupComponent, TargetComponent } from '../ship/index.js';
import {
    FormationComponent, NpcComponent, SystemHoldComponent,
} from '../npc/index.js';
import { MissionShipComponent, ShipObjective } from '../player/index.js';

/**
 * ============================================================================
 * The special ships of a mission ABORTED IN FLIGHT
 * ============================================================================
 *
 * The original does NOT remove them (reference "Aborting a mission in
 * flight from the `i` dialog, wave 13"). They lose their mission role and
 * fall back to their own AI and government, by mïsn ShipBehav:
 *
 *  - 1 (protect the player): the escort's brackets went from green to
 *    YELLOW (neutral) at once; it left the player, drifted about 1000 px
 *    and JUMPED OUT about 17 s after the abort.
 *  - 0 (always attack the player): both raiders stayed RED and kept
 *    shooting at the player 3, 8, 21 and 40 s after the abort, and were
 *    gone only once the player had landed and taken off again.
 *
 * Every other ShipBehav — -1 (standard AI) and 2 (bombard enemy stellars),
 * and aux ships, which have none — was not measured, so those ships keep
 * the deletion they had before: MissionShipCleanupSystem sweeps a mission
 * ship whose owner no longer holds its mission.
 *
 * WHAT "RELEASED" MEANS IN THE SIMULATION. The ship keeps its
 * MissionShipComponent (its name stays on the target pane) but turns
 * `untethered`: tied to the owner's PRESENCE only, the tether the
 * auto-aborted ambushes already use. So:
 *  - MissionShipCleanupSystem no longer deletes it for the missing
 *    mission, but still does once the owner leaves the system (lands or
 *    jumps) — the "gone after the player landed and took off again";
 *  - no goal system counts it (objectiveOf ignores untethered ships), and
 *    the respawn never mistakes it for its old mission's batch
 *    (liveMissionShips skips it), so a re-accepted mission is not short a
 *    ship and its goals and failure checks never see this one;
 *  - the mission's own holds go ('missionGoal', and 'rescue' for a
 *    hulk): its business here is over, so it may leave like any ship.
 *
 * Applied by applyAbortMission on every peer at the same tick, with the
 * abort's own input record: synchronous, no randomness, and the only
 * clock read is the simulation's own TimeResource.
 */

/**
 * How long after the abort a released ShipBehav-1 escort DECIDES to leave.
 * The original's escort was gone (off the radar) about 17 s after the
 * abort; the NPC departure that follows the decision — the run out of the
 * no-jump zone where needed, the stop, the turn, the 1 s spin-up and the
 * 2 s departure burn — takes the rest. mission_ship_release_test pins the
 * jump-out inside the measured window.
 */
export const ABORTED_ESCORT_DEPART_MS = 11_000;

/** ShipBehav 0: "Special ships will always attack the player". */
const BEHAV_ATTACK_PLAYER = 0;
/** ShipBehav 1: "Special ships will protect the player". */
const BEHAV_PROTECT_PLAYER = 1;

/**
 * Releases the special ships of `missionId`, owned by `ownerUuid`, that
 * the mission's ShipBehav says outlive an abort (see the module note).
 * Call BEFORE the mission leaves the owner's list: `objective` is the
 * aborted mission's own, and nothing else records the ShipBehav.
 */
export function releaseAbortedMissionShips(world: World, ownerUuid: string,
    missionId: string, objective: ShipObjective | undefined): void {
    const behavior = objective?.behavior;
    if (behavior !== BEHAV_ATTACK_PLAYER && behavior !== BEHAV_PROTECT_PLAYER) {
        return;
    }
    const now = world.resources.get(TimeResource)?.time ?? 0;
    for (const entity of world.entities.values()) {
        const missionShip = entity.components.get(MissionShipComponent);
        if (!missionShip || missionShip.aux || missionShip.untethered
            || missionShip.owner !== ownerUuid
            || missionShip.mission !== missionId) {
            continue;
        }
        // Replaced, not mutated in place: snapshots may share the object.
        entity.components.set(MissionShipComponent,
            { ...missionShip, untethered: true });
        const hold = entity.components.get(SystemHoldComponent)?.reason;
        if (hold === 'missionGoal' || hold === 'rescue') {
            entity.components.delete(SystemHoldComponent);
        }
        if (behavior === BEHAV_ATTACK_PLAYER) {
            // Still aggressed at the owner (mission_ship_spawn), so it
            // keeps fighting; nothing to change.
            continue;
        }
        // ShipBehav 1: out of the owner's flock — no formation, no shared
        // firing group — so its brackets and its own brain read its
        // government's stance again (neutral for an ordinary govt), and
        // off on its own business until it leaves.
        entity.components.delete(FormationComponent);
        entity.components.delete(FiringGroupComponent);
        const target = entity.components.get(TargetComponent);
        if (target) {
            target.target = undefined;
        }
        const npc = entity.components.get(NpcComponent);
        if (npc) {
            npc.mode = undefined;
            npc.aggressor = undefined;
            npc.destination = undefined;
            npc.waypoint = undefined;
            npc.boardTarget = undefined;
            delete npc.boardUntil;
            // `passingThrough` is what makes a trader (AI 1/2) act on
            // `departAt` without first finishing a trip and a dwell, and
            // an interceptor (AI 4) act on it at all (ordinary AI 4
            // traffic never leaves, npc_decision.ts); a warship acts on
            // it anyway.
            npc.passingThrough = true;
            npc.departAt = now + ABORTED_ESCORT_DEPART_MS;
        }
    }
}
