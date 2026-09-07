import { Entities } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import { EscortCommandComponent } from '../player/index.js';
import { SimulationGameDataResource } from '../core/index.js';
import { JumpComponent } from '../travel/index.js';
import { NpcComponent } from './npc_component.js';
import { NpcDecisionSystem } from './npc_decision.js';
import { NpcPlunderBoardSystem } from './npc_plunder_board.js';
import { TargetComponent } from '../ship/index.js';
import { suicideWeaponInReachState } from '../ship/index.js';
import { WeaponsStateComponent } from '../ship/index.js';

/**
 * NPC trigger control: holds the weapons' `firing` flags for the mode and
 * target NpcDecisionSystem chose (see the AI overview in npc_ai_plugin.ts).
 */

/** NPCs only fire within this range of their target. */
const NPC_FIRE_RANGE = 1200;

/**
 * Fires every weapon at the NPC's target while attacking and in range;
 * ceases fire otherwise.
 *
 * BAYS INCLUDED: a bay's ammo is its fighters (weapon_parse's
 * AmmoTypeParse), so the magazine bounds the total and the reload clock
 * paces the launches. No separate "has a target" gate is needed here —
 * `inRange` is already false unless the NPC is in attack mode with a
 * LIVE target entity, so an idle carrier never opens its hangar.
 * Launched fighters are pointed at the carrier's victim by
 * NpcWingCommandSystem (escort_command_plugin).
 *
 * A SHIP IN A JUMP SEQUENCE HOLDS ITS FIRE. NpcDecisionSystem bails on a
 * jumping ship so it cannot talk itself back into a fight, but bailing
 * PRESERVES the mode and target it was carrying when the sequence began —
 * so a ship already in 'attack' with a live victim goes on firing all
 * through its stop, its turn, its spin-up and its departure burn. That is
 * exactly the opposite of the "committed, so it disengages" the visible
 * sequence exists to show.
 *
 * WHO ACTUALLY REACHES THAT STATE. Not the NPC departure path:
 * departByJump is called from NpcSteeringSystem's 'flee' and 'depart'
 * arms, so the mode at the moment beginDepartureJump attaches the
 * component is structurally never 'attack'. The reachable case is a
 * FOLLOW jump. sweepableEscorts keys on the flock chain, not on
 * EscortCommandComponent, so an NPC FLEET ESCORT whose leader the player
 * captured (convertToEscort re-parents the leader onto the player; the
 * leader's own fleet escorts keep formation on it and are marked as the
 * player's) is swept into beginFollowJump while still running its own NPC
 * AI — including 'attack' with a live target, since it has no escort
 * command to make NpcDecisionSystem yield. Hired escorts, bay fighters
 * and mission ships all avoid it for their own reasons; this one does not.
 *
 * GATED, NOT CLEARED. The ship keeps its mode and target and simply does
 * not shoot while the JumpComponent is there; the weapons are released
 * (`firing = false`) on the tick the gate takes effect, which is what
 * stops a beam or a stream weapon that was already firing. Clearing the
 * target instead would be a one-way door: a sequence CANCELLED by a
 * disable (JumpDisableCancelSystem deletes the JumpComponent) would leave
 * the repaired ship blank and unable to defend itself until its next
 * think tick. With the gate, the same ship resumes firing on the very
 * tick the component goes, at the target it already had.
 */
export const NpcFireControlSystem = new System({
    name: 'NpcFireControlSystem',
    args: [NpcComponent, WeaponsStateComponent, TargetComponent,
        MovementStateComponent, Optional(JumpComponent), Entities,
        SimulationGameDataResource,
        Optional(EscortCommandComponent)] as const,
    step(npc, weapons, target, movement, jump, entities, gameData,
        escortCommand) {
        if (escortCommand) {
            // A player-commanded escort: the escort command framework
            // (escort_command_plugin) owns its TRIGGERS as well as its
            // steering. The other two halves of this AI already yield
            // to it — NpcDecisionSystem and NpcSteeringSystem both bail
            // on EscortCommandComponent — and fire control not doing so
            // was Matthew's "escorts sometimes don't fire when
            // commanded; they just circle the enemy" playtest report.
            //
            // THE MECHANISM. Because NpcDecisionSystem bails, a
            // commanded escort's `npc.mode` is never 'attack', so
            // `inRange` below is always false and this system used to
            // clear `firing` on EVERY weapon of EVERY escort that has an
            // NpcComponent — while EscortCommandBehaviorSystem set those
            // very same flags in the same tick. Neither system ordered
            // itself against the other, and this one runs later, so its
            // cease-fire was the write that survived into the latched
            // state WeaponsSystem reads.
            //
            // WHY IT LOOKED INTERMITTENT RATHER THAN TOTAL. Not
            // flakiness — system order is deterministic
            // (topologicalSortList is a stable function of registration
            // order), so an affected escort NEVER fired. What varied was
            // WHICH ESCORT, because only some kinds carry NpcComponent
            // at all:
            //   - hired escorts (spawnHiredEscorts -> makeNpcShip) and
            //     captured prizes (convertToEscort keeps the NPC brain,
            //     only clearing mode/aggressor) HAVE it -> silent;
            //   - bay-launched fighters do NOT (bay_plugin builds them
            //     with makeShip) -> they fired correctly all along.
            // So the same player, in the same session, saw some escorts
            // shoot and others just circle.
            //
            // STEERING NEVER SHOWED IT: EscortCommandBehaviorSystem is
            // the only writer of a commanded escort's movement, so the
            // ship orbited its victim at standoff exactly as ordered
            // while its guns stayed cold — the reported symptom.
            //
            // Bailing (rather than ordering the two systems) is what
            // keeps ALL of the escort framework's firing decisions
            // intact, not just the attack case: hold-fire while
            // landing/jumping, holdPosition's cease-fire, and the
            // formation-time front-quadrant-turret rule are equally
            // this system's to leave alone.
            //
            // NPC-CARRIER WINGS ARE COVERED, NOT ORPHANED. A bay fighter
            // launched by an NPC carrier carries EscortCommandComponent
            // too, and NpcWingCommandSystem mirrors the carrier's victim
            // onto it as an 'attack' command; EscortCommandBehaviorSystem
            // then fires its weapons. So the wings that reach this bail
            // have a live trigger-owner either way.
            return;
        }
        if (jump) {
            // Committed to leaving: cease fire for the whole sequence.
            // Falling through with `inRange` false would do the same, but
            // saying it here keeps the reason legible and skips the range
            // math for a ship that is not allowed to shoot regardless.
            for (const [, weapon] of weapons) {
                weapon.firing = false;
            }
            return;
        }
        const other = npc.mode === 'attack' && target.target
            ? entities.get(target.target)?.components
                .get(MovementStateComponent)
            : undefined;
        const distanceSquared = other === undefined ? Infinity
            : other.position.subtract(movement.position).lengthSquared;
        const inRange = distanceSquared <= NPC_FIRE_RANGE * NPC_FIRE_RANGE;
        for (const [id, weapon] of weapons) {
            if (!inRange) {
                weapon.firing = false;
                continue;
            }
            const weaponData = gameData.data.Weapon.getCached(id);
            if (weaponData == null) {
                continue;
            }
            // Turret blind spots are NOT filtered here, on purpose. This
            // system holds a trigger; it does not decide what leaves the
            // barrel. A turret whose target is in a blind sector is
            // refused by fireFromEntity (blind_spots.ts), which returns
            // without spawning a shot, without consuming ammo and
            // without restarting the reload clock — so latching `firing`
            // costs nothing and the turret opens up the instant the
            // target crosses into a live sector, with no per-weapon
            // geometry recomputed here every tick. The one AI site that
            // does need the predicate is the escort formation rule,
            // which CHOOSES a victim rather than just aiming at the
            // ship's existing target (escort_command_plugin).
            weapon.target = target.target;
            // NPC_FIRE_RANGE is a flat 1200px for every weapon, which is
            // the wrong price for a SUICIDE weapon (wëap AmmoType -999):
            // firing one out of range does not waste a round, it wastes
            // the ship. Held until the shot can connect — see
            // weapon_range.ts. (The matching "close all the way in"
            // steering lives in escort_command_plugin, because in
            // practice a suicide weapon reaches the field on a bay
            // fighter, and every bay fighter is an escort.)
            weapon.firing =
                suicideWeaponInReachState(weapon, distanceSquared);
        }
    },
    // NpcPlunderBoardSystem is a #237 pin (shared: *): NpcAiPlugin's
    // registration order.
    after: [NpcDecisionSystem, NpcPlunderBoardSystem],
});
