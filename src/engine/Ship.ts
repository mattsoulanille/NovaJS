import { ShipState } from "./ShipState";
import { SpaceObject } from "./SpaceObject";
import { Stateful } from "./Stateful";

class Ship extends SpaceObject implements Stateful<ShipState> {
    constructor() {
        super()
    }
}

export { Ship };
