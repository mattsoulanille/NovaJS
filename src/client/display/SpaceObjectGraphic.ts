import { AnimationGraphic } from "./AnimationGraphic";
import { SpaceObjectState } from "../../engine/SpaceObjectState";
import { VectorLike } from "../../engine/Vector";
import { BOUNDARY } from "../../engine/Position";


abstract class SpaceObjectGraphic extends AnimationGraphic {

    // private findClosest(target: number, input: number) {
    //     if (Math.abs(target - input) < BOUNDARY / 2) {
    //         return input;
    //     }
    //     else {
    // 		return 
    //     }
    // }

    // Accounts for modulus
    draw(state: SpaceObjectState, center: VectorLike) {

        this.position.x = state.position.x - center.x;
        this.position.y = state.position.y - center.y;


        this.rotation = state.rotation;
    }
}

export { SpaceObjectGraphic }
