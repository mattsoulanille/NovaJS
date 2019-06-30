import { ShipState } from "./ShipState";
import { Stateful, StateIndexer } from "./Stateful";
import { Vector } from "./Vector";
import { MovementType } from "./MovementType";

class Ship implements Stateful<ShipState> {

    constructor() {

    }

    getState(_missing?: StateIndexer | undefined): ShipState {
        return {
            movementType: MovementType.inertialess,
            position: new Vector(0, 0),
            uuid: "tmp",
            velocity: new Vector(0, 0),
        }
    }

    setState(_state: Partial<ShipState>): StateIndexer {
        throw new Error("Method not implemented.");
    }

}

export { Ship }
