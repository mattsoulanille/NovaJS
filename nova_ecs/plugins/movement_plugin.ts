import { Component } from '../component';
import { System } from '../system';
import * as t from 'io-ts';
import { applyObjectDelta, getObjectDelta } from './delta';
import { Time, TimeResource, TimeSystem } from './time_plugin';
import { Draft } from 'immer';
import { VectorType } from '../datatypes/vector';
import { Position, PositionType } from '../datatypes/position';
import { Angle, AngleType } from '../datatypes/angle';
import { Plugin } from '../plugin';

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

export const MovementPhysicsComponent = new Component({
    name: 'MovementPhysics',
    type: MovementPhysics,
    getDelta: getObjectDelta,
    applyDelta: applyObjectDelta
});

export const MovementState = t.type({
    position: PositionType,
    velocity: VectorType,
    rotation: AngleType,
    turning: t.number,
    turnBack: t.boolean,
    accelerating: t.number,
});
export type MovementState = t.TypeOf<typeof MovementState>;


// Don't split this into separate position and velocity components
// because we don't want to send predictable deltas, such as when
// an entity is moving in a straight line. When an unpredictable event happens,
// such as when a player accelerates, we send the full state.
export const MovementStateComponent = new Component({
    name: 'MovementState',
    type: MovementState,
    deltaType: MovementState,
    getDelta(a, b): MovementState | undefined {
        // Omit position.
        // Send everything if a delta is detected.
        const same = a.turning === b.turning &&
            a.accelerating === b.accelerating;

        if (same) {
            return;
        }
        return b;
    },
    applyDelta: applyObjectDelta,
});


export const MovementSystem = new System({
    name: 'movement',
    args: [MovementStateComponent, MovementPhysicsComponent, TimeResource] as const,
    step(state, physics, time) {
        if (physics.movementType === MovementType.INERTIAL) {
            inertialControls({ state, physics, time });
        } else if (physics.movementType === MovementType.INERTIALESS) {
            inertialessControls({ state, physics, time });
        }
    },
    after: ['ApplyChanges', TimeSystem],
    before: ['SendChanges'],
});


function inertialControls({ state, physics, time }:
    { state: Draft<MovementState>, physics: Draft<MovementPhysics>, time: Draft<Time> }) {

    // Turning
    // Handle the case where the ship is turning to point opposite
    // its velocity vector.
    if (state.turnBack) {
        if (state.velocity.length > 0) {
            let reverseAngle = state.velocity.angle.add(Math.PI);
            turnToDirection({ state, physics, time }, reverseAngle);
        }
    }

    state.rotation = state.rotation.add(state.turning * physics.turnRate * time.delta_s);

    // Acceleration
    if (state.accelerating > 0) {
        state.velocity = state.velocity.add(
            state.rotation.getUnitVector()
                .normalize(state.accelerating * physics.acceleration * time.delta_s));
    }
    state.velocity = state.velocity.shortenToLength(physics.maxVelocity);

    // Velocity
    // TODO: Make it so you don't have to cast
    state.position = state.position.add(state.velocity.scale(time.delta_s)) as Position;
}

function inertialessControls({ state, physics, time }:
    { state: Draft<MovementState>, physics: Draft<MovementPhysics>, time: Time }) {
    state.rotation = state.rotation.add(state.turning * physics.turnRate * time.delta_s);

    // Yes, it's inefficient, but it keeps a single source of
    // truth for velocity / speed.
    let speed = state.velocity.length;
    speed += state.accelerating * physics.acceleration * time.delta_s;
    state.velocity = state.rotation.getUnitVector()
        .scale(speed)
        .shortenToLength(physics.maxVelocity);

    state.position = state.position.add(state.velocity.scale(time.delta_s)) as Position;
}


function turnToDirection({ state, physics, time }:
    { state: Draft<MovementState>, physics: Draft<MovementPhysics>, time: Time },
    target: Draft<Angle>) {
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
        world.addComponent(MovementPhysicsComponent);
        world.addComponent(MovementStateComponent);
        world.addSystem(MovementSystem);
    }
};
