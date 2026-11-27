import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Resource } from 'nova_ecs/resource';

export enum Guidance {
    zeroOrder, // Point at the enemy
    firstOrder, // Linear approximation
};

/**
 * How guided missiles steer toward their target.
 *
 * Both modes are still limited by the projectile's documented turn rate
 * (applied downstream in the movement plugin); the difference is *where*
 * the missile aims.
 *
 * - `smart`: firstOrder guidance. The missile leads the target, solving
 *   for the intercept point given both velocities, so it aims at where the
 *   target *will be*. Very hard to dodge (the original behavior).
 * - `simple`: zeroOrder guidance. The missile only ever points at the
 *   target's *current* position, with no leading, so a target that circles
 *   or strafes can keep sidestepping the missile's aim and dodge it.
 *
 * DETERMINISM: this mode must be identical on every client in a room, so it
 * is stored as a simulation Resource with a hardcoded default set in
 * make_system.ts (the deterministic World builder every client and the
 * server's RoomArchive run). It is NOT a client-local setting. To change the
 * game-wide default, edit DEFAULT_MISSILE_GUIDANCE below.
 */
export enum MissileGuidanceMode {
    smart = 'smart',
    simple = 'simple',
};

/**
 * The game-wide default missile guidance mode. Change this to flip the whole
 * game between hard-to-dodge (`smart`) and dodgeable (`simple`) missiles.
 * Set into the World as MissileGuidanceResource by make_system.ts.
 */
export const DEFAULT_MISSILE_GUIDANCE = MissileGuidanceMode.simple;

/**
 * Server-distributed / deterministic simulation config selecting how guided
 * missiles steer. Set once at world construction (make_system.ts) so it is
 * identical for every client in a room. Read by ProjectileGuidanceSystem.
 */
export const MissileGuidanceResource =
    new Resource<{ mode: MissileGuidanceMode }>('MissileGuidance');

export function zeroOrderGuidance(position: Position, targetPosition: Position): Angle {
    // Point at the target
    return targetPosition.subtract(position).angle;
}

export function firstOrderGuidance(position: Position, velocity: Vector,
    targetPosition: Position, targetVelocity: Vector, shotSpeed: number): Angle[] {
    if (!(shotSpeed > 0)) {
        // A shot that does not move (or a NaN speed) has no intercept
        // solution; scaling by 1 / 0 below would poison the angles.
        return [];
    }
    const pos = targetPosition.subtract(position).scale(1 / shotSpeed);
    const vel = targetVelocity.subtract(velocity).scale(1 / shotSpeed);

    const a = vel.lengthSquared - 1;
    const b = 2 * pos.dot(vel);
    const c = pos.lengthSquared;

    let hitTimes: number[];
    if (a === 0) {
        // Relative speed exactly equals the shot speed: the quadratic
        // degenerates to the linear b*t + c = 0. The general branch
        // below would divide by 2a = 0 and yield an Infinity hit time,
        // whose intercept angle is NaN.
        if (b === 0) {
            return [];
        }
        hitTimes = [-c / b].filter(x => x >= 0);
    } else {
        const det = b ** 2 - 4 * a * c;
        if (det < 0) {
            return [];
        }

        const detSqrt = Math.sqrt(det);

        hitTimes = [
            (detSqrt - b) / (2 * a),
            (-detSqrt - b) / (2 * a),
        ].filter(x => x >= 0).sort((a, b) => a - b);
    }

    return hitTimes.map(time => pos.add(vel.scale(time)).angle);
}

/**
 * The EXACT intercept (despite the name: `firstOrderGuidance` solves the
 * quadratic for the meeting time), or straight at the target when there
 * is none. Still used by smart missile guidance (guidanceAngle), the
 * quadrant turrets' in-arc aim (wëap Guidance 7 / 8) and projectile
 * point defence (Guidance 9); a projectile turret (Guidance 4) leads to
 * first order instead (firstOrderLead).
 */
export function firstOrderWithFallback(position: Position, velocity: Vector,
    targetPosition: Position, targetVelocity: Vector, shotSpeed: number): Angle {
    const solutions = firstOrderGuidance(position, velocity, targetPosition, targetVelocity, shotSpeed);
    return solutions[0] ?? zeroOrderGuidance(position, targetPosition);
}

/**
 * A projectile turret's aim (wëap Guidance 4): the target's place plus
 * its velocity RELATIVE to the shooter times the distance over the shot
 * speed, `angle(d + dv x |d| / shotSpeed)`, with `d` the target's offset
 * from `position` (the exit point) and `dv` = target velocity - shooter
 * velocity. No quadratic and no fallback: the lead is always defined.
 *
 * MEASURED (reference "A turret's lead, and a lead into a blind sector
 * (the T leftover), wave 50", finding 1): over 47 coasting shots 380 px
 * or more from the target (three runs, five passes) the original's aim
 * lay 0.6 +- 0.9 deg from this first-order lead (range -1.9 .. +1.2)
 * while the exact intercept (firstOrderWithFallback) was 7-30 deg off;
 * the lead uses the shooter's own velocity (the target was still). So
 * against a fast crossing target the turret aims short of the intercept.
 * Under about 300 px the read aims drifted between the two (the line
 * swings several degrees a frame there); GUESS: first order at every
 * range.
 *
 * A shot speed of zero (or NaN) has nothing to lead with: straight at
 * the target, as firstOrderWithFallback's fallback. Deterministic: one
 * correctly-rounded sqrt (Vector.length), no trigonometry beyond the
 * angle every aim already takes.
 */
export function firstOrderLead(position: Position, velocity: Vector,
    targetPosition: Position, targetVelocity: Vector, shotSpeed: number): Angle {
    if (!(shotSpeed > 0)) {
        return zeroOrderGuidance(position, targetPosition);
    }
    const offset = Vector.fromVectorLike(targetPosition.subtract(position));
    const relative = targetVelocity.subtract(velocity);
    return offset.add(relative.scale(offset.length / shotSpeed)).angle;
}

/**
 * Pure guidance dispatch used by ProjectileGuidanceSystem. Picks the angle a
 * guided missile should aim at based on the room's MissileGuidanceMode.
 *
 * - `smart`: leads the target (firstOrder, intercept solution).
 * - `simple`: points straight at the target's current position (zeroOrder),
 *   no leading, so the missile is dodgeable by circling.
 */
export function guidanceAngle(mode: MissileGuidanceMode, position: Position,
    velocity: Vector, targetPosition: Position, targetVelocity: Vector,
    shotSpeed: number): Angle {
    if (mode === MissileGuidanceMode.simple) {
        return zeroOrderGuidance(position, targetPosition);
    }
    return firstOrderWithFallback(position, velocity, targetPosition,
        targetVelocity, shotSpeed);
}

export const GuidanceComponent = new Component<{
    guidance: Guidance,
}>('GuidanceComponent');
