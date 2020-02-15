import { Controller, ControlEvent } from "./Controller";
import { ShipState } from "novajs/nova/src/proto/ship_state_pb";



class ShipController {

    constructor(private readonly controller: Controller) {

    }

    generateShipState(): ShipState {
        const state = new ShipState();
        return state;

        // let controlState = this.controller.poll();

        // state.accelerating = Number(controlState[ControlEvent.accelerate].keyPressed);
        // state.turnBack = false;

        // if (controlState[ControlEvent.reverse].keyPressed) {
        //     state.turnBack = true;
        // }
        // else if (controlState[ControlEvent.turnLeft].keyPressed !== controlState[ControlEvent.turnRight].keyPressed) {
        //     if (controlState[ControlEvent.turnLeft].keyPressed) {
        //         state.turning = -1;
        //     }
        //     else {
        //         state.turning = 1;
        //     }
        // }
        // else {
        //     state.turning = 0;
        // }

        // return state;
    }

}

export { ShipController }
