import { Controller } from "../client/Controller";
import { ShipState } from "../engine/ShipState";
import { PartialState } from "../engine/Stateful";



class ShipController {

    constructor(private readonly controller: Controller) {

    }

    generateShipState(): PartialState<ShipState> {
        let state: PartialState<ShipState> = {};
        let controlState = this.controller.poll();

        state.accelerating = Number(controlState.accelerate.keyPressed);
        state.turnBack = false;

        if (controlState.reverse.keyPressed) {
            state.turnBack = true;
        }
        else if (controlState.turnLeft.keyPressed !== controlState.turnRight.keyPressed) {
            if (controlState.turnLeft.keyPressed) {
                state.turning = -1;
            }
            else {
                state.turning = 1;
            }
        }
        else {
            state.turning = 0;
        }

        return state;
    }

}

export { ShipController }
