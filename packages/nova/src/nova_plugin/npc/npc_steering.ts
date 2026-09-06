import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Optional } from 'nova_ecs/optional';
import { MovementState, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { DisabledComponent } from '../ship/index.js';
import { EscortCommandComponent } from '../player/index.js';
import { JumpComponent, JumpSequenceSystem, JUMP_DISTANCE } from '../travel/index.js';
import { NpcComponent } from './npc_component.js';
import { NpcDecisionSystem, WAYPOINT_RADIUS } from './npc_decision.js';
import { chaserBlocksJump, departByJump, steerOutward } from './npc_departure.js';
import { FormationComponent } from './npc_formation.js';
import { NPC_BOARD_RADIUS, NPC_BOARD_SPEED } from './npc_plunder.js';
import { EscortLandingComponent } from '../player/index.js';
import { ShipPhysicsComponent } from '../ship/index.js';
import { heldInSystem } from './system_hold.js';
import { TargetComponent } from '../ship/index.js';

/**
 * Executes the mode NpcDecisionSystem chose (see the AI overview in
 * npc_ai_plugin.ts): the arrival primitive and the per-mode steering.
 */

// --- Tuning constants ---

/** How long a trader loiters at a planet, standing in for landing
 * (real landing would despawn/respawn the ship; not worth it yet). */
export const TRADER_DWELL_MS = 12_000;
/** Traders arrive at a planet within this distance... */
const PLANET_ARRIVE_RADIUS = 90;
/** ...and below this speed (matches AttemptLandingSystem's numbers:
 * dist^2 < 10000, speed^2 < 3000). */
const PLANET_ARRIVE_SPEED = 50;
/** Distance at which an arriving ship starts braking. */
const ARRIVE_SLOW_RADIUS = 400;
/** Attackers stop thrusting toward their target inside this range. */
const ATTACK_STANDOFF = 250;

// --- Steering ---

/**
 * Point-and-thrust arrival: turn toward the goal and burn while far;
 * inside the slow radius, turn retrograde and brake until slow.
 * Built from the same movement primitives the jump sequence's
 * 'stopping' stage uses. Returns true once arrived.
 */
export function steerArrive(movement: MovementState, physics: {
    acceleration: number, turnRate: number,
}, goal: Position, arriveRadius: number, arriveSpeed: number): boolean {
    const toGoal = goal.subtract(movement.position);
    const distance = toGoal.length;
    const speed = movement.velocity.length;
    if (distance < arriveRadius && speed < arriveSpeed) {
        movement.accelerating = 0;
        movement.turnTo = null;
        movement.turnBack = false;
        return true;
    }
    // Time to stop at current speed vs. time to reach the goal:
    // brake when stopping distance (with margin) exceeds what's left.
    const stopDistance = physics.acceleration > 0
        ? speed * speed / (2 * physics.acceleration) : 0;
    if (distance < Math.max(arriveRadius, stopDistance * 1.5)
        || (distance < ARRIVE_SLOW_RADIUS && speed > arriveSpeed)) {
        // Brake: turn retrograde, thrust when roughly aligned.
        movement.turnTo = null;
        movement.turnBack = true;
        movement.accelerating = 0;
        if (speed > arriveSpeed * 0.5) {
            const reverse = movement.velocity.angle.add(Math.PI);
            const misalignment = movement.rotation.distanceTo(reverse).angle;
            if (Math.abs(misalignment) < 0.4) {
                movement.accelerating = 1;
            }
        }
        return false;
    }
    // Cruise: point at the goal, thrust when roughly aligned.
    movement.turnBack = false;
    const goalAngle = toGoal.angle;
    movement.turnTo = goalAngle;
    const misalignment = movement.rotation.distanceTo(goalAngle).angle;
    movement.accelerating = Math.abs(misalignment) < 0.6 ? 1 : 0;
    return false;
}

/**
 * Executes the NPC's current mode every tick. Departing and fleeing
 * ships hand themselves to the hyperspace jump sequence (see the NPC
 * DEPARTURE section of npc_ai_plugin.ts's overview, and
 * npc_departure.ts); everything else steers here.
 */
export const NpcSteeringSystem = new System({
    name: 'NpcSteeringSystem',
    args: [NpcComponent, MovementStateComponent, ShipPhysicsComponent,
        TargetComponent, Optional(FormationComponent),
        Optional(EscortCommandComponent), Optional(EscortLandingComponent),
        Optional(DisabledComponent), Optional(JumpComponent),
        TimeResource, Entities, GetEntity, UUID] as const,
    step(npc, movement, physics, target, formation, escortCommand, landing,
        disabled, jump, time, entities, entity, uuid) {
        if (jump) {
            // Committed to the hyperspace jump: JumpSequenceSystem owns
            // this ship's controls until it leaves (it overrides them
            // anyway). A ship disabled mid-sequence is no exception here
            // any more: the general disabled-cancels-jump rule
            // (JumpDisableCancelSystem) has already taken the
            // JumpComponent away before this system runs, so a disabled
            // ship never reaches this branch at all. If it is repaired
            // later it falls through to the mode switch below and decides
            // to depart afresh, starting a whole new sequence.
            return;
        }
        if (landing) {
            // Following the player down to a planet (player_escort_plugin
            // steers this ship). Checked before the escort-command bail so
            // an escort without command state still yields.
            return;
        }
        if (escortCommand) {
            return; // Player-commanded: see escort_command_plugin.
        }
        // Escorts holding formation are steered by FormationSystem —
        // unless they are off doing something of their own, a plunder run
        // included (a warship peeling out of formation to board a hulk
        // must not be dragged back to its station).
        if (formation && entities.has(formation.leader)
            && npc.mode !== 'attack' && npc.mode !== 'flee'
            && npc.mode !== 'depart' && npc.mode !== 'board') {
            return;
        }
        switch (npc.mode) {
            case 'travel': {
                const destination = npc.destination
                    ? entities.get(npc.destination)?.components
                        .get(MovementStateComponent)?.position
                    : undefined;
                if (!destination) {
                    return; // Decision system will re-plan.
                }
                const arrived = steerArrive(movement, physics,
                    Position.fromVectorLike(destination),
                    PLANET_ARRIVE_RADIUS, PLANET_ARRIVE_SPEED);
                if (arrived) {
                    npc.mode = 'dwell';
                    npc.until = time.time + TRADER_DWELL_MS;
                }
                break;
            }
            case 'dwell': {
                // Loiter: brake to a stop and sit.
                movement.turnTo = null;
                movement.accelerating = 0;
                const speed = movement.velocity.length;
                movement.turnBack = speed > 10;
                if (speed > 10) {
                    const reverse = movement.velocity.angle.add(Math.PI);
                    if (Math.abs(movement.rotation.distanceTo(reverse).angle)
                        < 0.4) {
                        movement.accelerating = 1;
                    }
                }
                break;
            }
            case 'patrol': {
                if (!npc.waypoint) {
                    return;
                }
                steerArrive(movement, physics,
                    new Position(npc.waypoint[0], npc.waypoint[1]),
                    WAYPOINT_RADIUS, physics.speed);
                break;
            }
            case 'board': {
                // Flying over to plunder a hulk (gövt Flags 0x1000). This
                // arm only STEERS; the arrival and the claim itself belong
                // to NpcPlunderBoardSystem, which sweeps in uuid order so
                // two warships reaching the same hulk on the same tick
                // cannot resolve differently on different peers.
                const prize = npc.boardTarget
                    ? entities.get(npc.boardTarget) : undefined;
                const prizeMovement =
                    prize?.components.get(MovementStateComponent);
                if (!prize || !prizeMovement
                    || !prize.components.has(DisabledComponent)) {
                    // Destroyed, jumped out, or patched up while we flew.
                    npc.mode = undefined;
                    npc.boardTarget = undefined;
                    return;
                }
                steerArrive(movement, physics,
                    Position.fromVectorLike(prizeMovement.position),
                    NPC_BOARD_RADIUS, NPC_BOARD_SPEED);
                break;
            }
            case 'attack': {
                const other = target.target
                    ? entities.get(target.target)?.components
                        .get(MovementStateComponent)
                    : undefined;
                if (!other) {
                    return;
                }
                const toTarget = other.position.subtract(movement.position);
                movement.turnTo = target.target!;
                movement.turnBack = false;
                movement.accelerating =
                    toTarget.length > ATTACK_STANDOFF ? 1 : 0;
                break;
            }
            case 'flee': {
                const aggressor = npc.aggressor
                    ? entities.get(npc.aggressor)?.components
                        .get(MovementStateComponent)
                    : undefined;
                // Far enough from the center to jump: start the jump
                // sequence (same exit as 'depart') — unless the chaser
                // is right behind (see chaserBlocksJump). The decision
                // is unchanged; only the exit is, so a fleeing ship is
                // now seen to align and warp out rather than blink away
                // — and it stays shootable, and interruptible by being
                // disabled, for the length of the sequence.
                if (movement.position.length > JUMP_DISTANCE
                    && !(aggressor
                        && chaserBlocksJump(movement, aggressor))
                    && departByJump(entity, movement, physics, disabled)) {
                    break;
                }
                // Run from the attacker; with no attacker position,
                // run outward from the system center.
                const away = aggressor
                    ? movement.position.subtract(aggressor.position)
                    : new Vector(movement.position.x, movement.position.y);
                // At the depart radius the ship is off the edge of the
                // playfield, so a chaser on its tail no longer holds it
                // here: it jumps anyway, and is deleted outright only if
                // it cannot (disabled). See departByJump.
                if (steerOutward(movement, away)
                    && !departByJump(entity, movement, physics, disabled)
                    && !heldInSystem(entity)) {
                    entities.delete(uuid);
                }
                break;
            }
            case 'depart': {
                // Fly outward until clear of the no-jump zone (the same
                // threshold the flee exit uses), then jump out.
                if (movement.position.length > JUMP_DISTANCE
                    && departByJump(entity, movement, physics, disabled)) {
                    break;
                }
                const away = new Vector(
                    movement.position.x, movement.position.y);
                // Only a ship that could not jump at all reaches the
                // depart radius (it is well outside the no-jump zone, so
                // the branch above already tried and was refused): the
                // old delete-at-the-edge exit, now the disabled-ship
                // fallback. A HELD ship is exempt: it is not allowed to
                // leave the system, and despawning it here would be
                // leaving by another name (see departByJump). It cannot
                // normally be in 'depart' at all — the decision system
                // refuses to put it there — but a hold applied to a ship
                // already on its way out must still stop it.
                if (steerOutward(movement, away) && !heldInSystem(entity)) {
                    entities.delete(uuid);
                }
                break;
            }
        }
    },
    after: [TimeSystem, NpcDecisionSystem],
    // Explicit edge rather than a toposort accident: a ship that decides
    // to leave this tick enters the sequence and starts stopping on the
    // same tick, and the ordering is stable across a snapshot restore
    // (determinism rule 4). The reverse edge would be a cycle via
    // DisabledMovementSystem, which is after both.
    before: [MovementSystem, JumpSequenceSystem],
});
