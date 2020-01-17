import { Position } from "../../engine/Position";
import { SpaceObjectState } from "../../engine/SpaceObjectState";
import { AnimationGraphic } from "./AnimationGraphic";


abstract class SpaceObjectGraphic extends AnimationGraphic {


    // Accounts for modulus
    draw(state: SpaceObjectState, center: Position) {

        let realPosition = new Position(
            state.position.x,
            state.position.y
        );

        let screenPosition = realPosition.getClosestRelativeTo(center).subtract(center);

        this.position.x = screenPosition.x;
        this.position.y = screenPosition.y;

        this.rotation = state.rotation;
    }
}

export { SpaceObjectGraphic };
