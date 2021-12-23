import { Animation } from "nova_data_interface/Animation";
import { MovementState } from "nova_ecs/plugins/movement_plugin";
import { mod } from "./mod";


const TWO_PI = 2 * Math.PI;

export function getFrameAndAngle(angle: number, frameCount: number) {
    const frame = mod(
        Math.round((angle / TWO_PI) * frameCount),
        frameCount
    );

    const partitionAngle = frame * TWO_PI / frameCount;
    const localAngle = angle - partitionAngle;

    return {
        frame,
        angle: localAngle
    };
}

export function getFrameFromMovement(animation: Animation, movement: MovementState) {
    const frames = animation.images.baseImage.frames;

    let frameData = frames.normal;
    if (frames.left && movement.turning < 0) {
        frameData = frames.left;
    } else if (frames.right && movement.turning > 0) {
        frameData = frames.right;
    }

    const { frame, angle } = getFrameAndAngle(movement.rotation.angle, frameData.length);
    return {
        frame: frame + frameData.start,
        angle,
    }
}
