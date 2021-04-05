import { Position } from 'nova_ecs/datatypes/position';

export enum Guidance {
    zeroOrder, // Point at the enemy
    firstOrder, // Linear approximation
};

export function zeroOrderGuidance(position: Position, targetPosition: Position) {
    // Point at the target
    return targetPosition.subtract(position).angle;
}


// TODO: First order approximation
