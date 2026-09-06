import { Entity } from 'nova_ecs/entity';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementState } from 'nova_ecs/plugins/movement_plugin';
import { ShipPhysics } from 'novadatainterface/ship_data';
import { DisabledState } from './disabled_component.js';
import { beginDepartureJump, JUMP_DISTANCE, JUMP_ARRIVAL_MARGIN_S } from './jump_plugin.js';
import { heldInSystem } from './system_hold.js';

/**
 * How an NPC leaves the system: the flee/depart exits NpcSteeringSystem
 * takes (see the NPC DEPARTURE section of npc_ai_plugin.ts's overview).
 */

/** Fleeing/departing ships are deleted ("jump out") beyond this radius. */
export const NPC_DEPART_RADIUS = JUMP_DISTANCE + 500 * JUMP_ARRIVAL_MARGIN_S;

// JUDGMENT CALL (Matthew wants to tune this): a fleeing ship that is
// far enough out to jump (outside the no-jump radius) jumps away —
// UNLESS its chaser is "right behind it". "Right behind" has no
// original-game definition, so it is defined here as: the chaser is
// within FLEE_JUMP_BLOCK_RANGE px AND inside the cone directly astern
// of the fleeing ship (within FLEE_JUMP_BLOCK_HALF_ANGLE of the
// direction opposite its heading) — close pursuit on its tail. A
// chaser alongside or ahead doesn't stop the jump.
export const FLEE_JUMP_BLOCK_RANGE = 500;
export const FLEE_JUMP_BLOCK_HALF_ANGLE = Math.PI / 3;

/**
 * Whether a pursuer is "right behind" a fleeing ship, blocking its
 * hyperspace escape (see the judgment-call note on the constants).
 */
export function chaserBlocksJump(fleeing: MovementState,
    chaser: MovementState): boolean {
    const toChaser = chaser.position.subtract(fleeing.position);
    if (toChaser.length > FLEE_JUMP_BLOCK_RANGE) {
        return false;
    }
    if (toChaser.lengthSquared < 1e-12) {
        return true;
    }
    const astern = Angle.fromAngleLike(fleeing.rotation).add(Math.PI);
    return Math.abs(astern.distanceTo(toChaser.angle).angle)
        < FLEE_JUMP_BLOCK_HALF_ANGLE;
}

/**
 * Hands a departing or fleeing NPC to the hyperspace jump sequence,
 * which owns it from here (NpcSteeringSystem bails while a
 * JumpComponent is present) until it warps out of the world.
 *
 * Returns false in the two cases the ship CANNOT jump:
 *
 *  - it is DISABLED — dead in space, unable to turn onto a jump heading
 *    or run its hyperdrive, the same reason PlayerJumpControl refuses a
 *    disabled player. Nothing else about a player's jump applies: this
 *    needs no route, no destination system data, and no fuel. A ship
 *    disabled on its way out keeps drifting and is deleted at
 *    NPC_DEPART_RADIUS as before; if it is repaired first, it jumps
 *    normally.
 *  - it is HELD in the system (system_hold.ts): a person whose refuel
 *    offer is still on the table, or a rescue target waiting to be
 *    boarded. Gated HERE rather than only in the decision system so that
 *    a 'flee' — which is not a departure decision at all, and which
 *    reaches the jump exit on its own — cannot carry the ship out of the
 *    system either. Held ships are exempted from the delete-at-the-edge
 *    fallback below for the same reason: refusing the jump must not
 *    despawn them through the back door.
 *
 * This is the only disabled check the NPC jump path needs. A ship
 * disabled AFTER the sequence starts is handled by the general
 * disabled-cancels-jump rule (JumpDisableCancelSystem), which stops it
 * dead and takes the JumpComponent away; because 'depart' and 'flee'
 * re-run this on every tick they own the ship, a repair simply lands the
 * NPC back here and it starts a fresh sequence. There is nothing to
 * resume, and no resume logic.
 */
export function departByJump(entity: Entity, movement: MovementState,
    physics: ShipPhysics, disabled: DisabledState | undefined): boolean {
    if (disabled || heldInSystem(entity)) {
        return false;
    }
    beginDepartureJump(entity, movement, physics);
    return true;
}

/** Fly outward and report whether the ship has reached the radius at
 * which a ship that never managed to jump is removed anyway. */
export function steerOutward(movement: MovementState, away: Vector): boolean {
    if (movement.position.length > NPC_DEPART_RADIUS) {
        return true;
    }
    const heading = away.lengthSquared > 1e-12 ? away.angle
        : new Angle(0);
    movement.turnTo = heading;
    movement.turnBack = false;
    const misalignment = movement.rotation.distanceTo(heading).angle;
    movement.accelerating = Math.abs(misalignment) < 0.8 ? 1 : 0;
    return false;
}
