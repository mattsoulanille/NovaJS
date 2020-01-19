import { Controller, ControlEvent } from "./Controller";
import { ShipState } from "../engine/ShipState";
import { PartialState } from "../engine/Stateful";



class ShipController {

    constructor(private readonly controller: Controller) {

    }

    generateShipState(): PartialState<ShipState> {
        let state: PartialState<ShipState> = {};
        let controlState = this.controller.poll();

        state.accelerating = Number(controlState[ControlEvent.accelerate].keyPressed);
        state.turnBack = false;

        if (controlState[ControlEvent.reverse].keyPressed) {
            state.turnBack = true;
        }
        else if (controlState[ControlEvent.turnLeft].keyPressed !== controlState[ControlEvent.turnRight].keyPressed) {
            if (controlState[ControlEvent.turnLeft].keyPressed) {
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
