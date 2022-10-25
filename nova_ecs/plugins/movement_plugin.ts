import * as t from 'io-ts';
import { Entities } from '../arg_types';
import { EntityMap } from '../entity_map';
import { Component } from '../component';
import { Angle, AngleType } from '../datatypes/angle';
import { Position, PositionType } from '../datatypes/position';
import { Vector, VectorLike, VectorType } from '../datatypes/vector';
import { Plugin } from '../plugin';
import { System } from '../system';
import { applyObjectDelta } from './delta';
import { DeltaPlugin, DeltaResource } from './delta_plugin';
import { Time, TimeResource, TimeSystem } from './time_plugin';


export enum MovementType {
    INERTIAL = 0,
    INERTIALESS = 1,
    STATIONARY = 2,
}

export const MovementPhysics = t.type({
    maxVelocity: t.number,
    turnRate: t.number,
    acceleration: t.number,
    movementType: t.union([
        t.literal(MovementType.INERTIAL),
        t.literal(MovementType.INERTIALESS),
        t.literal(MovementType.STATIONARY)]),
});
export type MovementPhysics = t.TypeOf<typeof MovementPhysics>;

export const MovementPhysicsComponent = new Component<MovementPhysics>('MovementPhysics');

export const MovementState = t.intersection([t.type({
    position: PositionType,
    velocity: VectorType,
    rotation: AngleType,
    turning: t.number,
    turnBack: t.boolean,
    accelerating: t.number,
}), t.partial({
    turnTo: t.union([AngleType, t.string /* target UUID */, t.null]),
    targetSpeed: t.number,
})]);
export type MovementState = t.TypeOf<typeof MovementState>;

// Don't split this into separate position and velocity components
// because we don't want to send predictable deltas, such as when
// an entity is moving in a straight line. When an unpredictable event happens,
// such as when a player accelerates, we send the full state.
export const MovementStateComponent = new Component<MovementState>('MovementState');

export const MovementSystem = new System({
    name: 'movement',
    args: [MovementStateComponent, MovementPhysicsComponent,
        TimeResource, Entities] as const,
    step(state, physics, time, entities) {
        if (physics.movementType === MovementType.INERTIAL) {
            inertialControls(state, physics, time, entities);
        } else if (physics.movementType === MovementType.INERTIALESS) {
            inertialessControls(state, physics, time, entities);
        }
    },
    after: ['ApplyChanges', TimeSystem],
    before: ['SendChanges'],
});

function inertialControls(state: MovementState, physics: MovementPhysics,
    time: Time, entities: EntityMap) {
    handleTurning(state, physics, time, entities);

    // Acceleration
    if (state.accelerating > 0) {
        state.velocity = state.velocity.add(
            state.rotation.getUnitVector()
                .normalize(state.accelerating * physics.acceleration * time.delta_s));
    }
    state.velocity = state.velocity.shortenToLength(physics.maxVelocity);

    // Velocity
    // TODO: Make it so you don't have to cast
    state.position = state.position
        .add(state.velocity.scale(time.delta_s)) as Position;
}

function inertialessControls(state: MovementState, physics: MovementPhysics,
    time: Time, entities: EntityMap) {
    handleTurning(state, physics, time, entities);

    if (state.targetSpeed === undefined) {
        state.targetSpeed = state.velocity.length;
    }

    state.targetSpeed += state.accelerating * physics.acceleration * time.delta_s;
    state.targetSpeed = Math.min(state.targetSpeed, physics.maxVelocity);
    state.targetSpeed = Math.max(state.targetSpeed, 0);

    const targetVelocity = state.rotation.getUnitVector().scale(state.targetSpeed);
    state.velocity = approachVec(targetVelocity, state.velocity,
        physics.acceleration * time.delta_s * 2);
    updatePosition(state, time);
}

function updatePosition(state: MovementState, time: Time) {
    state.position = state.position
        .add(state.velocity.scale(time.delta_s)) as Position;
}
function handleTurning(state: MovementState, physics: MovementPhysics,
    time: Time, entities: EntityMap) {
    // Turning
    if (state.turnTo) {
        let angle: Angle | undefined;
        if (state.turnTo instanceof Angle) {
            angle = state.turnTo;
        } else {
            const otherPosition = entities.get(state.turnTo)
                ?.components.get(MovementStateComponent)?.position;
            if (otherPosition) {
                angle = otherPosition.subtract(state.position).angle;
            }
        }
        if (angle) {
            turnToAngle(state, physics, time, angle);
        }
    } else if (state.turnBack) {
        if (state.velocity.length > 0) {
            let reverseAngle = state.velocity.angle.add(Math.PI);
            turnToAngle(state, physics, time, reverseAngle);
        }
    }

    state.rotation = state.rotation
        .add(state.turning * physics.turnRate * time.delta_s);
}

export function approachVec<T extends Vector>(target: T, current: T, maxDelta: number): T {
    if (current.x === target.x && current.y === target.y) {
        return target;
    }
    const difference = target.subtract(current);
    if (difference.lengthSquared < maxDelta ** 1.2) {
        return target;
    }

    return current.add(difference.normalize().scale(maxDelta)) as T;
}

function turnToAngle(state: MovementState, physics: MovementPhysics,
    time: Time, target: Angle) {
    // Used for turning retrograde and pointing at a target
    let difference = state.rotation.distanceTo(target);

    // If we would turn past the target direction, just go to the target direction.
    if (physics.turnRate * time.delta_s > Math.abs(difference.angle)) {
        state.turning = 0;
        state.rotation = target;
    }
    else if (difference.angle > 0) {
        state.turning = 1;
    }
    else {
        state.turning = -1;
    }
}

export const MovementPlugin: Plugin = {
    name: 'MovementPlugin',
    build(world) {
        world.addPlugin(DeltaPlugin);
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        deltaMaker.addComponent(MovementStateComponent, {
            componentType: MovementState,
        });

        deltaMaker.addComponent(MovementPhysicsComponent, {
            componentType: MovementPhysics
        });

        world.addComponent(MovementPhysicsComponent);
        world.addComponent(MovementStateComponent);
        world.addSystem(MovementSystem);
    }
};
