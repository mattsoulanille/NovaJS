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
 *  - -1 (standard AI): a DISABLED ship of a destroy and of a disable goal
 *    stayed where it was, still "Disabled", for the rest of the watch
 *    (reference "Boarding live mission ships, wave 61"). The original's
 *    AbortMission clears the mission index on every special ship of the
 *    mission whatever its ShipBehav, so 2 (bombard enemy stellars, not
 *    measured) is released the same way: each ship carries on under its
 *    own AI and government.
 *
 * Aux ships (not measured) keep the deletion they had before:
 * MissionShipCleanupSystem sweeps a mission ship whose owner no longer
 * holds its mission.
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

/** ShipBehav 1: "Special ships will protect the player". */
const BEHAV_PROTECT_PLAYER = 1;

/**
 * Releases every special ship of `missionId`, owned by `ownerUuid`, from
 * its mission (see the module note), whatever its ShipBehav. Call BEFORE
 * the mission leaves the owner's list: `objective` is the aborted
 * mission's own, and nothing else records the ShipBehav.
 *
 * The deferred auto-abort ending at the board (applyAbortMission, when the
 * mission is `autoAbortPending`) releases the same way: the original's
 * boarded "Kit Pers Hulk" stayed where it was, an ordinary ship ("No
 * Shields", no longer boardable), after the mission ended in flight
 * (reference "The deferred (përs) auto-abort (R16), wave 43").
 */
export function releaseAbortedMissionShips(world: World, ownerUuid: string,
    missionId: string, objective: ShipObjective | undefined): void {
    const behavior = objective?.behavior;
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
        if (behavior !== BEHAV_PROTECT_PLAYER) {
            // ShipBehav 0: still aggressed at the owner
            // (mission_ship_spawn), so it keeps fighting; nothing to
            // change. Any other: its own AI already.
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
