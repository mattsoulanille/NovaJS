import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';

export enum Guidance {
    zeroOrder, // Point at the enemy
    firstOrder, // Linear approximation
};

export function zeroOrderGuidance(position: Position, targetPosition: Position): Angle {
    // Point at the target
    return targetPosition.subtract(position).angle;
}

export function firstOrderGuidance(position: Position, velocity: Vector,
    targetPosition: Position, targetVelocity: Vector, shotSpeed: number): Angle[] {
    const pos = targetPosition.subtract(position).scale(1 / shotSpeed);
    const vel = targetVelocity.subtract(velocity).scale(1 / shotSpeed);

    const a = vel.lengthSquared - 1;
    const b = 2 * pos.dot(vel);
    const c = pos.lengthSquared;

    let hitTimes: number[] = [];
    if (a === 0) {
        if (b === 0) {
            return [];
        }
        hitTimes = [-c / b];
    }

    const det = b ** 2 - 4 * a * c;
    if (det < 0) {
        return [];
    }

    const detSqrt = Math.sqrt(det);

    hitTimes = [
        (detSqrt - b) / (2 * a),
        (-detSqrt - b) / (2 * a),
    ].filter(x => x >= 0).sort((a, b) => a - b);

    return hitTimes.map(time => pos.add(vel.scale(time)).angle);
}

export function firstOrderWithFallback(position: Position, velocity: Vector,
    targetPosition: Position, targetVelocity: Vector, shotSpeed: number): Angle {
    const solutions = firstOrderGuidance(position, velocity, targetPosition, targetVelocity, shotSpeed);
    return solutions[0] ?? zeroOrderGuidance(position, targetPosition);
}
