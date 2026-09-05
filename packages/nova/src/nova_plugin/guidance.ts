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

export function firstOrderWithFallback(position: Position, velocity: Vector,
    targetPosition: Position, targetVelocity: Vector, shotSpeed: number): Angle {
    const solutions = firstOrderGuidance(position, velocity, targetPosition, targetVelocity, shotSpeed);
    return solutions[0] ?? zeroOrderGuidance(position, targetPosition);
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
