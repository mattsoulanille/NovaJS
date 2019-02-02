import { Vector } from "./Vector";
import { MovementType } from "./MovementType";
import { WithUUID } from "./WithUUID";


type SpaceObjectState = WithUUID & {

    // Convex Hulls are not stored in the state
    // because the state would be too big.
    // They are instead stored in the 
    position: Vector,
    velocity: Vector,
    movementType: MovementType

}

export { SpaceObjectState }
