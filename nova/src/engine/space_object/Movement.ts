import { copyState } from "../CopyState";
import { GetNextState } from "../Stateful";
import { SpaceObjectView } from "../TreeView";
import { Angle, Vector } from "../Vector";
import { Position } from "./Position";

export const movement: GetNextState<SpaceObjectView> = function({ state, nextState, delta }) {
    nextState = nextState ?? state.factory();
    copyState(state.protobuf, nextState.protobuf, [
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
    const position = Position.fromProto(nextState.protobuf.position);
    const velocity = Vector.fromProto(nextState.protobuf.velocity);
    const rotation = new Angle(nextState.protobuf.rotation ?? 0);

    const seconds = delta / 1000;

    if (nextState.protobuf.turnBack) {
        if (velocity.getLength() > 0) {
            let reverseAngle = velocity.getAngle();
            reverseAngle.add(Math.PI);
            nextState = turnToDirection({ nextState, delta }, reverseAngle);
        }
    }

    rotation.add(
        (nextState.protobuf.turning ?? 0)
        * (nextState.protobuf.turnRate ?? 1)
        * seconds);

    // Acceleration
    if ((nextState.protobuf.accelerating ?? 0) > 0) {
        const unitAngle = rotation.getUnitVector();
        unitAngle.scaleToLength(
            (nextState.protobuf.accelerating!)
            * (nextState.protobuf.acceleration ?? 0)
            * seconds);

        velocity.add(unitAngle);
    }

    velocity.shortenToLength(nextState.protobuf.maxVelocity ?? 0);
    position.add(Vector.scale(velocity, seconds));

    nextState.protobuf.velocity = velocity.toProto();
    nextState.protobuf.position = position.toProto();
    nextState.protobuf.rotation = rotation.angle;
    return nextState;
}

function turnToDirection({ nextState, delta }:
    { nextState: SpaceObjectView, delta: number }, target: Angle) {
    // Used for turning retrograde and pointing at a target
    const rotation = new Angle(nextState.protobuf.rotation ?? 0);
    const seconds = delta / 1000;
    let difference = rotation.distanceTo(target);

    // If we would turn past
    // the target direction,
    // just go to the target direction
    if ((nextState.protobuf.turnRate ?? 1) * seconds
        > Math.abs(difference)) {
        nextState.protobuf.turning = 0;
        nextState.protobuf.rotation = target.angle;
    }
    else if (difference > 0) {
        nextState.protobuf.turning = 1;
    }
    else {
        nextState.protobuf.turning = -1;
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
