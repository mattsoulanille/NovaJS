import { Entities, UUID } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { EntityMap } from 'nova_ecs/entity_map';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { System } from 'nova_ecs/system';
import { EscortCommandComponent, MissionShipComponent } from '../player/index.js';
import { SimulationGameDataResource } from '../core/index.js';
import { JumpComponent } from '../travel/index.js';
import { flockPlayer } from './allegiance.js';
import { aimsWithHull, MINE_AIM_TOLERANCE, minesWith } from './npc_mining.js';
import { NpcComponent } from './npc_component.js';
import { NpcDecisionSystem } from './npc_decision.js';
import { NpcPlunderBoardSystem } from './npc_plunder_board.js';
import { TargetComponent } from '../ship/index.js';
import { suicideWeaponInReachState } from '../ship/index.js';
import { WeaponsState, WeaponsStateComponent } from '../ship/index.js';

/**
 * NPC trigger control: holds the weapons' `firing` flags for the mode and
 * target NpcDecisionSystem chose (see the AI overview in npc_ai_plugin.ts).
 */

/** NPCs only fire within this range of their target. */
const NPC_FIRE_RANGE = 1200;

/**
 * A miner's trigger (mode 'mine', npc_mining.ts): every weapon it mines
 * with (minesWith) fires at the rock while the rock is within that
 * weapon's reach and, for a fixed gun or beam, while the nose is within
 * MINE_AIM_TOLERANCE of it; everything else holds. Weapon data comes from
 * the same staged cache the attack branch reads. No PRNG.
 */
function fireAtRock(rockUuid: string | undefined,
    weapons: WeaponsState, movement: MovementState, entities: EntityMap,
    gameData: SimulationGameDataInterface) {
    const rock = rockUuid === undefined ? undefined
        : entities.get(rockUuid)?.components.get(MovementStateComponent);
    const toRock = rock?.position.subtract(movement.position);
    const distanceSquared = toRock?.lengthSquared ?? Infinity;
    const aimed = toRock !== undefined && distanceSquared > 0 && Math.abs(
        movement.rotation.distanceTo(toRock.angle).angle) <= MINE_AIM_TOLERANCE;
    let minerWeaponsOnly = false;
    for (const [id, weapon] of weapons) {
        const data = gameData.data.Weapon.getCached(id);
        if (weapon.count > 0 && data && 'asteroidMiner' in data
            && data.asteroidMiner) {
            minerWeaponsOnly = true;
            break;
        }
    }
    for (const [id, weapon] of weapons) {
        const data = gameData.data.Weapon.getCached(id);
        if (!rock || !data || weapon.count <= 0
            || !minesWith(data, minerWeaponsOnly)
            || weapon.reach === undefined
            || distanceSquared > weapon.reach * weapon.reach
            || (aimsWithHull(data) && !aimed)) {
            weapon.firing = false;
            continue;
        }
        weapon.target = rockUuid;
        weapon.firing = true;
    }
}

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
 * NpcWingCommandSystem (escort_command_plugin). On the original a stock
 * Fed Carrier in ordinary traffic launched its Vipers and Anacondas at
 * the player it was attacking (reference_experiments "B NPC carrier
 * wave 5").
 *
 * EXCEPT A MISSION SHIP PROTECTING A PLAYER. A mïsn ShipBehav 1 carrier
 * (a kit carrier and the stock Fed Carrier alike) fought raiders
 * attacking the player for 70 s with its own guns and NEVER launched
 * (reference "Q4"). Here that is a mission ship (MissionShipComponent) in
 * a player's flock (allegiance.ts's flockPlayer): ShipBehav 1 ships and
 * escort-goal ships, which mission_ship_spawn puts in formation on their
 * owner. Its bays hold; its other weapons fire as usual. Ships in the
 * flock that ARE the player's (hired or captured escorts) never reach
 * this system (the escort-command bail below): a carrier escort's bays
 * are pulled by EscortCommandBehaviorSystem's fireAt while it engages
 * (unmeasured on the original; GUESS, see there).
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
        Optional(EscortCommandComponent), UUID,
        Optional(MissionShipComponent)] as const,
    step(npc, weapons, target, movement, jump, entities, gameData,
        escortCommand, uuid, missionShip) {
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
            // formation-time turret rule are equally
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
        if (npc.mode === 'mine') {
            fireAtRock(npc.mineTarget, weapons, movement, entities, gameData);
            return;
        }
        const other = npc.mode === 'attack' && target.target
            ? entities.get(target.target)?.components
                .get(MovementStateComponent)
            : undefined;
        const distanceSquared = other === undefined ? Infinity
            : other.position.subtract(movement.position).lengthSquared;
        const inRange = distanceSquared <= NPC_FIRE_RANGE * NPC_FIRE_RANGE;
        // Walked only when there is something to shoot at; it reads the
        // synced flock links alone, so every peer agrees.
        const protector = inRange && missionShip !== undefined
            && flockPlayer(uuid, id => entities.get(id)) !== undefined;
        for (const [id, weapon] of weapons) {
            if (!inRange) {
                weapon.firing = false;
                continue;
            }
            const weaponData = gameData.data.Weapon.getCached(id);
            if (weaponData == null) {
                continue;
            }
            if (protector && weaponData.type === 'BayWeaponData') {
                // Reference Q4: a carrier protecting the player keeps its
                // fighters in the hangar.
                weapon.firing = false;
                continue;
            }
            // Turret blind spots are NOT filtered here, on purpose. This
            // system holds a trigger; it does not decide what leaves the
            // barrel. A full turret whose target is in a blind sector is
            // refused by fireFromEntity (blind_spots.ts; a quadrant
            // turret there fires straight along its axis instead, the
            // same as the player's), which returns
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
