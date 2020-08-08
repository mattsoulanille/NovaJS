import { copyState } from "../CopyState";
import { StepState } from "../Stateful";
import { SpaceObjectView } from "../TreeView";
import { Angle, Vector } from "../Vector";
import { Position } from "./Position";

export const movement: StepState<SpaceObjectView> = function({ state, nextState, delta }) {
    nextState = nextState ?? state.factory();
    copyState(state.sharedData, nextState.sharedData, [
        "accelerating",
        "acceleration",
        "maxVelocity",
        "movementType",
        "position",
        "rotation",
        "turnBack",
        "turning",
        "turnRate",
        "velocity",
    ], true /* overwrite because of primitives like rotation*/);

    nextState = doInertialControls({ nextState, delta });

    return nextState;
}

function doInertialControls({ nextState, delta }:
    { nextState: SpaceObjectView, delta: number }): SpaceObjectView {
    // Turning
    const position = Position.fromProto(nextState.sharedData.position);
    const velocity = Vector.fromProto(nextState.sharedData.velocity);
    const rotation = new Angle(nextState.sharedData.rotation ?? 0);

    const seconds = delta / 1000;

    if (nextState.sharedData.turnBack) {
        if (velocity.getLength() > 0) {
            let reverseAngle = velocity.getAngle();
            reverseAngle.add(Math.PI);
            nextState = turnToDirection({ nextState, delta }, reverseAngle);
        }
    }

    rotation.add(
        (nextState.sharedData.turning ?? 0)
        * (nextState.sharedData.turnRate ?? 1)
        * seconds);

    // Acceleration
    if ((nextState.sharedData.accelerating ?? 0) > 0) {
        const unitAngle = rotation.getUnitVector();
        unitAngle.scaleToLength(
            (nextState.sharedData.accelerating!)
            * (nextState.sharedData.acceleration ?? 0)
            * seconds);

        velocity.add(unitAngle);
    }

    velocity.shortenToLength(nextState.sharedData.maxVelocity ?? 0);
    position.add(Vector.scale(velocity, seconds));

    nextState.sharedData.velocity = velocity.toProto();
    nextState.sharedData.position = position.toProto();
    nextState.sharedData.rotation = rotation.angle;
    return nextState;
}

function turnToDirection({ nextState, delta }:
    { nextState: SpaceObjectView, delta: number }, target: Angle) {
    // Used for turning retrograde and pointing at a target
    const rotation = new Angle(nextState.sharedData.rotation ?? 0);
    const seconds = delta / 1000;
    let difference = rotation.distanceTo(target);

    // If we would turn past
    // the target direction,
    // just go to the target direction
    if ((nextState.sharedData.turnRate ?? 1) * seconds
        > Math.abs(difference)) {
        nextState.sharedData.turning = 0;
        nextState.sharedData.rotation = target.angle;
    }
    else if (difference > 0) {
        nextState.sharedData.turning = 1;
    }
    else {
        nextState.sharedData.turning = -1;
    }
    return nextState;
}



// export class Movement implements Stateful<SpaceObjectView> {
//     getNextState({ state, nextState, delta }:
//         { state: SpaceObjectView, nextState: SpaceObjectView, delta: number; }): SpaceObjectView {

//         nextState = nextState ?? state.factory();
//         copyState(state.value, nextState.value, [
//             "accelerating",
//             "acceleration",
//             "maxVelocity",
//             "movementType",
//             "position",
//             "rotation",
//             "turnBack",
//             "turning",
//             "turnRate",
//             "velocity",
//         ]);

//         nextState = this.doInertialControls({ nextState, delta });

//         return nextState;
//     }

//     private doInertialControls({ nextState, delta }:
//         { nextState: SpaceObjectView, delta: number }): SpaceObjectView {
//         // Turning
//         const position = Position.fromProto(nextState.value.position);
//         const velocity = Vector.fromProto(nextState.value.velocity);
//         const rotation = new Angle(nextState.value.rotation ?? 0);

//         const seconds = delta / 1000;

//         if (nextState.value.turnBack) {
//             if (velocity.getLength() > 0) {
//                 let reverseAngle = velocity.getAngle();
//                 reverseAngle.add(Math.PI);
//                 nextState = this.turnToDirection({ nextState, delta }, reverseAngle);
//             }
//         }

//         rotation.add(
//             (nextState.value.turning ?? 0)
//             * (nextState.value.turnRate ?? 1)
//             * seconds);

//         // Acceleration
//         if ((nextState.value.accelerating ?? 0) > 0) {
//             const unitAngle = rotation.getUnitVector();
//             unitAngle.scaleToLength(
//                 (nextState.value.accelerating!)
//                 * (nextState.value.acceleration ?? 0)
//                 * seconds);

//             velocity.add(unitAngle);
//         }

//         velocity.shortenToLength(nextState.value.maxVelocity ?? 0);
//         position.add(Vector.scale(velocity, seconds));

//         nextState.value.velocity = velocity.toProto();
//         nextState.value.position = position.toProto();
//         nextState.value.rotation = rotation.angle;
//         return nextState;
//     }

//     private turnToDirection({ nextState, delta }:
//         { nextState: SpaceObjectView, delta: number }, target: Angle) {
//         // Used for turning retrograde and pointing at a target
//         const rotation = new Angle(nextState.value.rotation ?? 0);
//         const seconds = delta / 1000;
//         let difference = rotation.distanceTo(target);

//         // If we would turn past
//         // the target direction,
//         // just go to the target direction
//         if ((nextState.value.turnRate ?? 1) * seconds
//             > Math.abs(difference)) {
//             nextState.value.turning = 0;
//             nextState.value.rotation = target.angle;
//         }
//         else if (difference > 0) {
//             nextState.value.turning = 1;
//         }
//         else {
//             nextState.value.turning = -1;
//         }
//         return nextState;
//     }
// }
