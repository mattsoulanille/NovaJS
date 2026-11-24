import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
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
import {
    INTERCEPTOR_ORBIT_RADIUS, NpcDecisionSystem, WAYPOINT_RADIUS,
} from './npc_decision.js';
import { chaserBlocksJump, departByJump, steerOutward } from './npc_departure.js';
import { FormationComponent } from './npc_formation.js';
import { NPC_BOARD_RADIUS, NPC_BOARD_SPEED } from './npc_plunder.js';
import { CONTRABAND_SCAN_RANGE } from './contraband.js';
import {
    MINE_HOLD_SPEED, MINE_STANDOFF_FRACTION, miningReach, SCOOP_ARRIVE_RADIUS,
    SCOOP_ARRIVE_SPEED,
} from './npc_mining.js';
import { EscortLandingComponent } from '../player/index.js';
import { ShipPhysicsComponent } from '../ship/index.js';
import { heldInSystem } from './system_hold.js';
import {
    RETREAT_STANDOFF_HOLD_SPEED, RETREAT_STANDOFF_MAX, RETREAT_STANDOFF_MIN,
} from './npc_retreat.js';
import { TargetComponent, WeaponsStateComponent } from '../ship/index.js';
import { updateNpcCloak } from './npc_cloak.js';

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
/** A cruising ship aims along its velocity error (cruise speed straight
 * at the goal, minus its velocity) PLUS a pull of this fraction of its
 * cruise speed straight at the goal (see steerArrive). The pull is what
 * the heading follows once the error has shrunk to nothing, so the nose
 * settles on the goal instead of on floating-point residue; it fades into
 * the error as the error grows, so there is no band edge to flip across.
 * Fitted, not measured: a quarter of cruise speed is far above the
 * residue (the error that set the heading before) and well below the
 * drift of the #316 Cargo Drone orbit the error-burn exists to cancel (a
 * sideways velocity of top speed is an error of 1.4 x top speed). It is
 * also the "on course" band for coasting in (ARRIVE_APPROACH_SPEED_FRACTION). */
export const ARRIVE_GOAL_PULL_FRACTION = 0.25;
/** Inside the slow radius, an arrival that must come in below top speed
 * cruises at this fraction of its arrival speed (see steerArrive). Fitted:
 * anything under 1 keeps a cruising ship out of the brake branch; 0.9
 * keeps the last stretch about as quick as it was (the old controller
 * hovered at the arrival speed), and the on-course band
 * (ARRIVE_GOAL_PULL_FRACTION) around it is wide enough that a ship
 * coasting in at just under the arrival speed is left alone. */
export const ARRIVE_APPROACH_SPEED_FRACTION = 0.9;
/** Attackers stop thrusting toward their target inside this range. */
const ATTACK_STANDOFF = 250;
/** An orbiting ship (steerOrbit) that is this far off its circle steers
 * 45° off the tangent toward it; nearer, proportionally less. Fitted: a
 * gentle return (a fighter-speed hull covers it in about a second) that
 * does not have the nose chasing the radial error back and forth. */
export const ORBIT_CORRECTION_DISTANCE = 200;
/** ...and never more than atan(3), about 72° off the tangent, so a ship
 * far outside the circle (just launched, back from a chase) spirals in
 * rather than flying at the planet and having to turn through 90° at the
 * circle. */
const ORBIT_MAX_CORRECTION = 3;
/** How fast (per second) an orbiting ship turns its velocity onto its
 * course, on top of the circle's own rate: a velocity 0.1 rad off course
 * is asked to turn 0.2 rad/s faster. Fitted: closes a course error in
 * about half a second without overshooting it. */
const ORBIT_COURSE_GAIN = 2;

// --- Steering ---

/**
 * How far out a speed-limited arrival (steerArrive) starts slowing for
 * its goal: ARRIVE_SLOW_RADIUS, or the room the hull needs to turn around
 * at top speed (half a turn at its turn rate) and then brake from top
 * speed to `arriveSpeed`, whichever is farther. Only slow-turning fast
 * hulls need more than the slow radius (the Leviathan, nova:192, 481 px).
 */
export function arriveSlowRadius(physics: {
    acceleration: number, turnRate: number, speed: number,
}, arriveSpeed: number): number {
    if (!(physics.turnRate > 0) || !(physics.acceleration > 0)) {
        return ARRIVE_SLOW_RADIUS;
    }
    const flip = physics.speed * Math.PI / physics.turnRate;
    const brake = Math.max(0, physics.speed * physics.speed
        - arriveSpeed * arriveSpeed) / (2 * physics.acceleration);
    return Math.max(ARRIVE_SLOW_RADIUS, flip + brake);
}

/**
 * Point-and-thrust arrival: steer toward the goal and burn while far;
 * inside the slow radius, turn retrograde and brake until slow.
 * Built from the same movement primitives the jump sequence's
 * 'stopping' stage uses. Returns true once arrived.
 */
export function steerArrive(movement: MovementState, physics: {
    acceleration: number, turnRate: number, speed: number,
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
    // An arrival at top speed (a patrol waypoint) has no speed to shed on
    // the way in. Reading `speed > arriveSpeed` for it anyway braked a
    // ship burning at its speed cap, which rounding leaves a hair over it.
    const speedLimited = arriveSpeed < physics.speed;
    // Where a speed-limited arrival starts slowing: the slow radius, or
    // farther out if the hull needs more room than that to TURN AROUND (a
    // half turn at its turn rate, flown at top speed) and then brake from
    // top speed to the arrival speed. A slow-turning fast hull (the
    // Leviathan, nova:192: 67.5 px/s, 13.5 px/s^2, 30°/s, a 6 s flip
    // covering 405 px) began its flip at the slow radius and sailed
    // straight past the planet, 216 px out the far side, before it had
    // braked and could come back. Fixed per hull (top speed, a full half
    // turn) rather than from the current speed and the turn still left:
    // either of those shrinks as the ship comes round and slows, and let
    // it out of the brake, nose forward again, short of the planet.
    const slowRadius = speedLimited
        ? arriveSlowRadius(physics, arriveSpeed) : ARRIVE_SLOW_RADIUS;
    if (distance < Math.max(arriveRadius, stopDistance * 1.5)
        || (speedLimited && distance < slowRadius
            && speed > arriveSpeed)) {
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
    // Cruise: thrust along (cruise speed straight at the goal) minus (the
    // current velocity), when roughly aligned. Pointing the nose at the
    // goal itself never burns off velocity ACROSS the line to it, and a
    // hull with a lot of top speed for its acceleration then orbits the
    // goal outside the braking radius forever (#316: the stock Cargo
    // Drone, Speed 400 / Accel 200, takes 5 s to reach top speed and did
    // exactly that). Burning along the velocity error cancels the drift
    // and reduces to "point at the goal" when there is none.
    //
    // The cruise speed is top speed, except on the last stretch (inside
    // the slow radius) of an arrival that has to come in slower than top
    // speed: there it is just under the arrival speed. Asking for top
    // speed there drove a ship that had just braked to the arrival speed
    // straight back over it, into the brake branch above, and it flipped
    // between "retrograde" and "nose on the goal" every second or so all
    // the way in (any hull faster than 50 px/s, at every planet).
    movement.turnBack = false;
    const slowing = speedLimited && distance < slowRadius;
    const cruiseSpeed = slowing
        ? Math.min(physics.speed, ARRIVE_APPROACH_SPEED_FRACTION * arriveSpeed)
        : physics.speed;
    const burn = toGoal.normalize(cruiseSpeed)
        .subtract(Vector.fromVectorLike(movement.velocity));
    const pull = ARRIVE_GOAL_PULL_FRACTION * cruiseSpeed;
    if (slowing && speed >= cruiseSpeed && burn.length <= pull) {
        // Coasting the last stretch in at (just under) the arrival speed,
        // on course and typically nose-back from the brake: no burn
        // wanted, so no turn either. The current heading, not null: a
        // null turnTo leaves the ship turning at whatever rate it last
        // turned.
        movement.turnTo = Angle.fromAngleLike(movement.rotation);
        movement.accelerating = 0;
        return false;
    }
    // Aim along the error plus a steady pull at the goal. On course the
    // error is a sliver whose DIRECTION is noise: at its speed cap a ship
    // is left an error that is all cross-track, 90° off its course, whose
    // sign flips as it flies. Steering by the bare error swung slow
    // freighters (a Leviathan or a Pegasus pottering in to a planet at
    // 40-50 px/s) back and forth by up to 90° every few seconds, all the
    // way in (Matthew, 2026-11-23: "Why so much wiggling?"). With the
    // pull the nose sits on the goal; the burn there tops the speed up,
    // or at the cap just swings the velocity onto the nose, mopping up
    // the drift. (A hard switch between "on the goal" and "along the
    // error" made patrolling warships ride the switch, swinging between
    // the two.)
    const aim = burn.add(toGoal.normalize(pull));
    // The aim can only vanish for a ship well over its cruise speed
    // straight at the goal (overspeed bleeding off); nose on the goal.
    const heading = aim.length > pull / 2 ? aim.angle : toGoal.angle;
    movement.turnTo = heading;
    const misalignment = movement.rotation.distanceTo(heading).angle;
    movement.accelerating = Math.abs(misalignment) < 0.6 ? 1 : 0;
    return false;
}

/**
 * Circles `centre` at `radius` (an interceptor, AI 4, round its home
 * planet), in the direction the old orbit waypoints advanced: the
 * direction of increasing clock angle about the centre.
 *
 * The COURSE is the circle's tangent turned toward the circle by the
 * radial error (ORBIT_CORRECTION_DISTANCE, ORBIT_MAX_CORRECTION). The ship
 * flies it at top speed, thrusting whenever its nose is roughly where it
 * wants it, and steers its VELOCITY onto the course by where it points
 * that thrust: at top speed (the cap holds the speed) thrust at an angle
 * φ off the velocity turns it at acceleration * sin φ / speed, so the nose
 * leads the velocity by the φ that gives the turn rate wanted: the
 * circle's own rate (speed / radius) plus ORBIT_COURSE_GAIN times the
 * angle the velocity is off the course. On the circle that is a steady
 * lead (Firebird: 62° inside its velocity, Aurora Carrier: 12°), and the
 * nose turns round with the course at a steady rate, one way.
 *
 * Replaces chasing discrete orbit waypoints (45° apart, each re-aimed and
 * braked for within WAYPOINT_RADIUS), which swung fighter-speed hulls'
 * noses back and forth about once a second all the way round. A hull that
 * cannot turn tightly enough for the circle at top speed (sin φ would pass
 * 1) flies a wider one, held by the radial correction. Below a tenth of
 * top speed (setting off) the velocity has no useful direction and the
 * nose simply points along the course. No PRNG.
 */
export function steerOrbit(movement: MovementState, physics: {
    acceleration: number, speed: number,
}, centre: Position, radius: number) {
    const fromCentre = movement.position.subtract(centre);
    const distance = fromCentre.length;
    // On the centre itself any radial will do; take the nose.
    const radial = distance > 1e-9
        ? Vector.fromVectorLike(fromCentre).normalize(1)
        : movement.rotation.getUnitVector();
    // The radial turned a quarter clockwise: unit vectors are
    // (sin θ, -cos θ), so this is the unit vector at θ + π/2.
    const tangent = new Vector(-radial.y, radial.x);
    const correction = Math.max(-ORBIT_MAX_CORRECTION,
        Math.min(ORBIT_MAX_CORRECTION,
            (distance - radius) / ORBIT_CORRECTION_DISTANCE));
    const course = tangent.subtract(radial.scale(correction)).angle;
    const velocity = Vector.fromVectorLike(movement.velocity);
    const speed = velocity.length;
    let heading = course;
    if (speed > 0.1 * physics.speed && physics.acceleration > 0) {
        const offCourse = velocity.angle.distanceTo(course).angle;
        const turnRate = speed / radius + ORBIT_COURSE_GAIN * offCourse;
        const sinLead = Math.max(-1, Math.min(1,
            turnRate * speed / physics.acceleration));
        heading = velocity.angle.add(Math.asin(sinLead));
    }
    movement.turnBack = false;
    movement.turnTo = heading;
    const misalignment = movement.rotation.distanceTo(heading).angle;
    movement.accelerating = Math.abs(misalignment) < 0.6 ? 1 : 0;
}

/**
 * The gövt 0x0010 stand-off (npc_retreat.ts): get to the band
 * RETREAT_STANDOFF_MIN-MAX px from the enemy, on the line through it, and
 * once there (and slow) turn to face it so forward guns bear. Uses the
 * arrival primitive, so a ship running in at speed brakes rather than
 * sailing through the band. With the two ships on top of each other the
 * escape heading is the ship's own facing.
 */
export function steerStandoff(movement: MovementState, physics: {
    acceleration: number, turnRate: number, speed: number,
}, targetUuid: string, enemy: Position) {
    const fromEnemy = movement.position.subtract(enemy);
    const mid = (RETREAT_STANDOFF_MIN + RETREAT_STANDOFF_MAX) / 2;
    const offset = fromEnemy.lengthSquared > 1e-12
        ? fromEnemy.normalize(mid)
        : movement.rotation.getUnitVector().scale(mid);
    const held = steerArrive(movement, physics, enemy.add(offset),
        (RETREAT_STANDOFF_MAX - RETREAT_STANDOFF_MIN) / 2,
        RETREAT_STANDOFF_HOLD_SPEED);
    if (held) {
        movement.turnTo = targetUuid;
    }
}

/**
 * Flies a miner to its rock and holds it there, nose on: within `reach`
 * and slow, it stops thrusting and turns to face the rock (NpcFireControl
 * fires); otherwise it arrives at a point MINE_STANDOFF_FRACTION of
 * `reach` off the rock, on the line from the rock to itself. Rocks drift
 * (10-50 px/s), so a rock that drifts out of reach is simply approached
 * again. No PRNG.
 */
export function steerMine(movement: MovementState, physics: {
    acceleration: number, turnRate: number, speed: number,
}, rockUuid: string, rock: Position, reach: number) {
    const fromRock = movement.position.subtract(rock);
    const distance = fromRock.length;
    if (distance <= reach
        && movement.velocity.length <= 2 * MINE_HOLD_SPEED) {
        movement.turnTo = rockUuid;
        movement.turnBack = false;
        movement.accelerating = 0;
        return;
    }
    const standoff = MINE_STANDOFF_FRACTION * reach;
    const offset = fromRock.lengthSquared > 1e-12
        ? fromRock.normalize(standoff)
        : movement.rotation.getUnitVector().scale(standoff);
    if (steerArrive(movement, physics, rock.add(offset), standoff / 2,
        MINE_HOLD_SPEED)) {
        movement.turnTo = rockUuid;
    }
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
        Optional(WeaponsStateComponent),
        TimeResource, Entities, GetEntity, UUID] as const,
    step(npc, movement, physics, target, formation, escortCommand, landing,
        disabled, jump, weapons, time, entities, entity, uuid) {
        // A 0x0800 trader's cloak (npc_cloak.ts), every tick, whatever
        // the arm below does or skips.
        updateNpcCloak(entity, npc, time.time);
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
            && npc.mode !== 'depart' && npc.mode !== 'board'
            && npc.mode !== 'scan') {
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
                // An interceptor (AI 4) circles its home planet.
                const home = npc.aiType === 4 && npc.destination
                    ? entities.get(npc.destination)?.components
                        .get(MovementStateComponent)?.position
                    : undefined;
                if (home) {
                    steerOrbit(movement, physics,
                        Position.fromVectorLike(home),
                        INTERCEPTOR_ORBIT_RADIUS);
                    break;
                }
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
            case 'scan': {
                // Buzzing a player ship to scan it for contraband (AI 4,
                // contraband_scan.ts). This arm only STEERS: the scan
                // itself is ContrabandScanSystem's, in uuid order, once
                // within CONTRABAND_SCAN_RANGE. Flown at top speed
                // ("buzzes"), so the ship closes fast and brakes only as
                // it comes up on a slow target.
                const quarry = npc.scanTarget
                    ? entities.get(npc.scanTarget)?.components
                        .get(MovementStateComponent)
                    : undefined;
                if (!quarry) {
                    npc.mode = undefined;
                    delete npc.scanTarget;
                    return;
                }
                steerArrive(movement, physics,
                    Position.fromVectorLike(quarry.position),
                    CONTRABAND_SCAN_RANGE / 2, physics.speed);
                break;
            }
            case 'mine': {
                // A miner shooting a rock apart (npc_mining.ts). This arm
                // only STEERS; NpcFireControlSystem pulls the trigger.
                const rock = npc.mineTarget
                    ? entities.get(npc.mineTarget)?.components
                        .get(MovementStateComponent)
                    : undefined;
                const reach = weapons ? miningReach(weapons) : undefined;
                if (!rock || reach === undefined) {
                    // Broken up (or the guns are gone): the decision
                    // system picks the debris or the next rock.
                    npc.mode = undefined;
                    delete npc.mineTarget;
                    return;
                }
                steerMine(movement, physics, npc.mineTarget!,
                    Position.fromVectorLike(rock.position), reach);
                break;
            }
            case 'scoop': {
                // A miner flying over a debris box; ScoopSystem takes it
                // into the hold on contact (combat/asteroid_plugin.ts).
                const box = npc.mineTarget
                    ? entities.get(npc.mineTarget)?.components
                        .get(MovementStateComponent)
                    : undefined;
                if (!box) {
                    // Scooped, or faded away.
                    npc.mode = undefined;
                    delete npc.mineTarget;
                    return;
                }
                steerArrive(movement, physics,
                    Position.fromVectorLike(box.position),
                    SCOOP_ARRIVE_RADIUS, SCOOP_ARRIVE_SPEED);
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
                if (npc.retreatSince !== undefined) {
                    // A gövt 0x0010 warship that is losing: hold off
                    // instead of closing (npc_retreat.ts).
                    steerStandoff(movement, physics, target.target!,
                        Position.fromVectorLike(other.position));
                    break;
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
