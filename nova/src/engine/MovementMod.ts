import { Draft, Patch } from "immer";
import { ImmerStepper, immerStepperFactory, makeImmerMod } from "./ImmerStepper";
import { Position } from "./Position";
import { StateTreeMod } from "./StateTreeMod";
import { Angle, Vector } from "./Vector";

export enum MovementType {
    INERTIAL = 0,
    INERTIALESS = 1,
    STATIONARY = 2,
}

export interface MovementFactoryData {
    maxVelocity: number;
    turnRate: number;
    acceleration: number;
    movementType: MovementType;
}

export type MovementState = MovementFactoryData & {
    position: Position;
    velocity: Vector;
    rotation: Angle;
    turning: number;
    turnBack: boolean;
    accelerating: number;
}


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
    if (state.turnBack) {
        if (state.velocity.length > 0) {
            let reverseAngle = state.velocity.angle;
            reverseAngle.add(Math.PI);
            turnToDirection({ state, time }, reverseAngle);
        }
    }

    // Acceleration
    if (state.accelerating > 0) {
        const unitAngle = state.rotation.getUnitVector();
        unitAngle.normalize(state.accelerating * state.acceleration * time);
        state.velocity.add(unitAngle);
    }
    state.velocity.shortenToLength(state.maxVelocity);

    // Velocity
    state.position.add(state.velocity.scaled(time));
}

function inertialessControls({ state, time }:
    { state: Draft<MovementState>, time: number }) {

    state.rotation.add(state.turning * state.turnRate * time);

    // Yes, it's inefficient, but it keeps a single source of
    // truth for velocity / speed.
    let speed = state.velocity.length;
    speed += state.accelerating * state.acceleration * time;
    state.velocity = state.rotation.getUnitVector()
        .scale(speed)
        .shortenToLength(state.maxVelocity);

    state.position.add(state.velocity.scaled(time));
}

function turnToDirection({ state, time }:
    { state: Draft<MovementState>, time: number }, target: Draft<Angle>) {
    // Used for turning retrograde and pointing at a target
    let difference = state.rotation.distanceTo(target);

    // If we would turn past
    // the target direction,
    // just go to the target direction
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

export const MovementMod = makeImmerMod("movement", stateFactory, stepState, [["position"]]);
