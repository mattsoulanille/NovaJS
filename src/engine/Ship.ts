import { ShipState } from "./ShipState";
import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
import { Vector } from "./Vector";
import { MovementType } from "./MovementType";

class Ship implements Stateful<ShipState> {

    constructor() {

    }

    getState(_missing: StateIndexer<ShipState> = {}): RecursivePartial<ShipState> {
        return {
            movementType: MovementType.inertialess,
            position: new Vector(0, 0),
            uuid: "tmp",
            velocity: new Vector(0, 0),
        }
    }

    setState(_state: Partial<ShipState>): StateIndexer<ShipState> {
        throw new Error("Method not implemented.");
    }

}

export { Ship }
