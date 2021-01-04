import { Draft, Patch } from "immer";
import { makeImmerMod } from "./ImmerStepper";
import { Position } from "./Position";
import { Angle, AngleLike, Vector, VectorLike } from "./Vector";
import * as t from 'io-ts';

type ForSomeReasonThisIsRequired = Patch;

export enum MovementType {
    INERTIAL = 0,
    INERTIALESS = 1,
    STATIONARY = 2,
}

export const MovementFactoryData = t.type({
    maxVelocity: t.number,
    turnRate: t.number,
    acceleration: t.number,
    movementType: t.union([
        t.literal(MovementType.INERTIAL),
        t.literal(MovementType.INERTIALESS),
        t.literal(MovementType.STATIONARY)]),
});

export type MovementFactoryData = t.TypeOf<typeof MovementFactoryData>;

// This state must be JSON.stringify -able.
export const MovementState = t.intersection([MovementFactoryData,
    t.type({
        position: VectorLike,
        velocity: VectorLike,
        rotation: AngleLike,
        turning: t.number,
        turnBack: t.boolean,
        accelerating: t.number,
    })]);

export type MovementState = t.TypeOf<typeof MovementState>;

function stepState({ state, time }:
    { state: Draft<MovementState>, time: number }) {
    if (state.movementType === MovementType.INERTIAL) {
        inertialControls({ state, time });
    } else if (state.movementType === MovementType.INERTIALESS) {
        inertialessControls({ state, time });
    }
}

function inertialControls({ state, time }:
    { state: Draft<MovementState>, time: number }) {
    // Turning
    // Handle the case where the ship is turning to point opposite
    // its velocity vector.

    let velocity = Vector.fromVectorLike(state.velocity);
    if (state.turnBack) {
        if (velocity.length > 0) {
            let reverseAngle = velocity.angle.add(Math.PI);
            turnToDirection({ state, time }, reverseAngle);
        }
    }

    // Acceleration
    const rotation = Angle.fromAngleLike(state.rotation);
    if (state.accelerating > 0) {
        velocity = velocity.add(
            rotation.getUnitVector()
                .normalize(state.accelerating * state.acceleration * time));
    }
    velocity = velocity.shortenToLength(state.maxVelocity);

    // Velocity
    // TODO: Make it so you don't have to cast
    let position = Position.fromVectorLike(state.position);
    position = position.add(velocity.scale(time)) as Position;

    state.position = position;
    state.velocity = velocity;
}

function inertialessControls({ state, time }:
    { state: Draft<MovementState>, time: number }) {
    let rotation = Angle.fromAngleLike(state.rotation);
    rotation = rotation.add(state.turning * state.turnRate * time);

    // Yes, it's inefficient, but it keeps a single source of
    // truth for velocity / speed.
    let velocity = Vector.fromVectorLike(state.velocity);
    let speed = velocity.length;
    speed += state.accelerating * state.acceleration * time;
    state.velocity = rotation.getUnitVector()
        .scale(speed)
        .shortenToLength(state.maxVelocity);

    let position = Position.fromVectorLike(state.position);
    position = position.add(velocity.scale(time)) as Position;

    state.position = position;
    state.velocity = velocity;
}

function turnToDirection({ state, time }:
    { state: Draft<MovementState>, time: number }, target: Draft<Angle>) {
    // Used for turning retrograde and pointing at a target
    const rotation = Angle.fromAngleLike(state.rotation);
    let difference = rotation.distanceTo(target);

    // If we would turn past the target direction, just go to the target direction.
    if (state.turnRate * time > Math.abs(difference.angle)) {
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

function stateFactory(movementFactoryData: MovementFactoryData): MovementState {
    return {
        maxVelocity: movementFactoryData.maxVelocity,
        turnRate: movementFactoryData.turnRate,
        acceleration: movementFactoryData.acceleration,
        movementType: movementFactoryData.movementType,
        position: new Position(0, 0),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        turning: 0,
        turnBack: false,
        accelerating: 0
    }
}

export const MovementMod = makeImmerMod("movement", stateFactory, stepState,
    [["position"], ["velocity"]]);
