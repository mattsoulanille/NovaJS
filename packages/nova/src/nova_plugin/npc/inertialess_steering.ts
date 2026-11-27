import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import {
    MovementPhysics, MovementState, MovementType,
} from 'nova_ecs/plugins/movement_plugin';

/**
 * Steering for INERTIALESS hulls (shïp Flags2 0x0040; movement_plugin's
 * inertialessControls), shared by every AI steering path.
 *
 * Such a hull has no momentum to manage: its velocity is its heading times
 * `targetSpeed`, and `targetSpeed` only changes with the throttle
 * (`accelerating`, negative to brake; reference "U9 and the inertialess
 * hulls": it keeps its speed when thrust is released, and Down brakes it to
 * a stop). The inertial steering idioms do nothing useful on it:
 *
 *  - "thrust when roughly aligned, else 0" never sheds `targetSpeed`, so
 *    the hull keeps whatever speed it last had for good;
 *  - turning retrograde to brake just flies it the other way at the same
 *    speed, and a direct velocity nudge (RCS, damping) is undone on the
 *    next integration, which pulls the velocity back onto
 *    heading x targetSpeed at twice the acceleration.
 *
 * So an inertialess hull steered like an inertial one never slowed for a
 * goal: it circled a planet it was meant to park at and an attack target
 * it was meant to hold off from, at top speed, for good. It is flown
 * directly instead: POINT where it should go and THROTTLE its speed to the
 * wanted velocity's part along the nose (flyInertialess). The formation
 * keeper (npc_formation.ts) was the first user; the NPC arrivals
 * (npc_steering.ts), the escort attack and hold (escort_command_plugin.ts)
 * and the escort landing approach (player_escort_plugin.ts) hand their
 * inertialess hulls here too. A bay fighter flying home (ReturnAI) needs
 * nothing: it holds its nose on the carrier at full thrust, the velocity
 * follows the nose, so the range only closes and it rams home as an
 * inertial fighter does. An NPC's own attack run (npc_steering's 'attack'
 * arm) is left as it was: nose on the target, so it makes passes through
 * it at the speed it has, which reads as dogfighting.
 */

/** Top speed, acceleration and turn rate of a hull, as the integrator
 * applies them this tick (the EFFECTIVE MovementPhysics: afterburner,
 * ionization; see inertialessPhysics). The `speed` name is ShipPhysics's. */
export interface SteeringPhysics {
    acceleration: number;
    turnRate: number;
    speed: number;
}

/**
 * An inertialess approach closes no faster than it can brake from:
 * sqrt(2 x this x acceleration x distance). GUESS, the formation keeper's
 * and the escort landing controller's fraction (FORMATION_BRAKE_FRACTION,
 * ESCORT_APPROACH_BRAKE_FRACTION): the throttle can brake at the full
 * acceleration, so half of it leaves room for the speed the nose costs
 * as it comes round.
 */
export const INERTIALESS_APPROACH_BRAKE_FRACTION = 0.5;
/**
 * ...and no faster than this x turn rate x distance: the hull's turning
 * circle (speed / turn rate) then stays inside half the distance left, so
 * a nose chasing the goal always comes round onto it instead of orbiting
 * it a turning radius out. GUESS, the formation keeper's fraction
 * (FORMATION_TURN_CLOSING_FRACTION).
 */
export const INERTIALESS_APPROACH_TURN_FRACTION = 0.5;

/**
 * The throttle (`accelerating`, -1 full brake to 1 full thrust) that takes
 * an inertialess hull's `targetSpeed` this tick to `desired`'s component
 * along its CURRENT nose (none while it faces away from it): the speed
 * change over this tick's acceleration, clamped. So targetSpeed lands on
 * the wanted speed instead of hunting round it, the hull slows to turn and
 * speeds up as it comes round, and `accelerating` is only positive while
 * it gains speed (the engine glow shows thrust, not station-keeping).
 * `acceleration` must be the one the integrator applies (the effective
 * MovementPhysics), or the throttle over- or undershoots every tick.
 */
export function inertialessThrottle(movement: MovementState,
    desired: Vector, acceleration: number, delta_s: number): number {
    const forward = movement.rotation.getUnitVector();
    const speed = Math.max(0, forward.x * desired.x + forward.y * desired.y);
    const current = movement.targetSpeed ?? movement.velocity.length;
    const step = acceleration * delta_s;
    return step > 0 ? Math.max(-1, Math.min(1, (speed - current) / step)) : 0;
}

/**
 * Flies an inertialess hull at the velocity `desired`: turns it to
 * `heading` (an angle, or an entity uuid MovementSystem resolves to a
 * bearing) and throttles as inertialessThrottle. Never touches the
 * velocity directly (the integrator would undo it) and never turns
 * retrograde.
 */
export function flyInertialess(movement: MovementState, desired: Vector,
    heading: Angle | string, acceleration: number, delta_s: number): void {
    movement.turnBack = false;
    movement.turnTo = heading;
    movement.accelerating = inertialessThrottle(movement, desired,
        acceleration, delta_s);
}

const STILL = new Vector(0, 0);

/**
 * Brings an inertialess hull to a stop where it is, holding its heading (a
 * null turnTo would leave it turning at whatever rate it last turned, and
 * the velocity follows the nose). `heading` overrides the held heading:
 * a ship stopping to face something.
 */
export function brakeInertialess(movement: MovementState,
    acceleration: number, delta_s: number,
    heading: Angle | string = Angle.fromAngleLike(movement.rotation)): void {
    flyInertialess(movement, STILL, heading, acceleration, delta_s);
}

/**
 * The speed (px/s) at which an inertialess hull closes on a point
 * `distance` px off: top speed, capped at what it can brake from
 * (INERTIALESS_APPROACH_BRAKE_FRACTION) and turn onto
 * (INERTIALESS_APPROACH_TURN_FRACTION). 0 at the point itself.
 */
export function inertialessApproachSpeed(distance: number,
    physics: SteeringPhysics): number {
    if (!(distance > 0)) {
        return 0;
    }
    return Math.min(physics.speed,
        Math.sqrt(2 * INERTIALESS_APPROACH_BRAKE_FRACTION
            * Math.max(0, physics.acceleration) * distance),
        INERTIALESS_APPROACH_TURN_FRACTION * physics.turnRate * distance);
}

/**
 * Flies an inertialess hull to `goal` and stops it there (or, with
 * `goalVelocity`, matches a moving goal), nose on the goal: the desired
 * velocity is the goal's plus inertialessApproachSpeed straight at it,
 * from `standoff` px short of it (a gun range: the hull closes to it and
 * then only matches the goal's velocity). `heading` overrides the nose's
 * aim (an attacker keeps its guns on its target's uuid). On the goal
 * itself it brakes. Returns the distance to the goal.
 */
export function steerInertialessTo(movement: MovementState, goal: Position,
    physics: SteeringPhysics, delta_s: number,
    { goalVelocity, standoff = 0, heading }: {
        goalVelocity?: Vector, standoff?: number, heading?: Angle | string,
    } = {}): number {
    const toGoal = goal.subtract(movement.position);
    const distance = toGoal.length;
    const base = goalVelocity ?? STILL;
    if (!(distance > 1e-9)) {
        flyInertialess(movement, base,
            heading ?? Angle.fromAngleLike(movement.rotation),
            physics.acceleration, delta_s);
        return distance;
    }
    const closing = inertialessApproachSpeed(distance - standoff, physics);
    const desired = closing > 0 ? base.add(toGoal.normalize(closing)) : base;
    flyInertialess(movement, desired, heading ?? toGoal.angle,
        physics.acceleration, delta_s);
    return distance;
}

/**
 * The SteeringPhysics to fly an inertialess hull by, or undefined for any
 * other: the effective MovementPhysics when the entity has it (the numbers
 * the integrator applies this tick), else the ship's own (ShipPhysics: an
 * `inertialess` flag, `speed`).
 */
export function inertialessPhysics(movementPhysics: MovementPhysics | undefined,
    shipPhysics?: SteeringPhysics & { inertialess?: boolean }):
    SteeringPhysics | undefined {
    if (movementPhysics) {
        return movementPhysics.movementType === MovementType.INERTIALESS
            ? {
                acceleration: movementPhysics.acceleration,
                turnRate: movementPhysics.turnRate,
                speed: movementPhysics.maxVelocity,
            }
            : undefined;
    }
    return shipPhysics?.inertialess ? {
        acceleration: shipPhysics.acceleration,
        turnRate: shipPhysics.turnRate,
        speed: shipPhysics.speed,
    } : undefined;
}
