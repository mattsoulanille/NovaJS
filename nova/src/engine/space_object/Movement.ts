import { Draft } from "immer";
import { SpaceObject, Step } from "../State";
import { Angle } from "../Vector";

export const movement: Step<SpaceObject> = ({ state, delta }) => {
    // TODO: Make inertialess controls.
    doInertialControls({ state, delta });
}

const doInertialControls: Step<SpaceObject> = ({ state, delta }) => {
    // Turning
    // Handle the case where the ship is turning to point opposite
    // its velocity vector.
    if (state.turnBack) {
        if (state.velocity.length > 0) {
            let reverseAngle = state.velocity.angle;
            reverseAngle.add(Math.PI);
            turnToDirection({ state, delta }, reverseAngle);
        }
    }
    state.rotation.add(state.turning * state.turnRate * delta);

    // Acceleration
    if (state.accelerating > 0) {
        const unitAngle = state.rotation.getUnitVector();
        unitAngle.normalize(state.accelerating * state.acceleration * delta);
        state.velocity.add(unitAngle);
    }
    state.velocity.shortenToLength(state.maxVelocity);

    // Velocity
    state.position.add(state.velocity.scaled(delta));
}

function turnToDirection({ state, delta }:
    { state: Draft<SpaceObject>, delta: number }, target: Draft<Angle>) {
    // Used for turning retrograde and pointing at a target
    let difference = state.rotation.distanceTo(target);

    // If we would turn past
    // the target direction,
    // just go to the target direction
    if (state.turnRate * delta > Math.abs(difference.angle)) {
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
