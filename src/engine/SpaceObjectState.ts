import * as t from "io-ts";
import { VectorType } from "./Vector";
import { MovementType } from "./MovementType";


const SpaceObjectState =
    t.type({
        position: VectorType,
        velocity: VectorType,
        movementType: MovementType
    });


type SpaceObjectState = t.TypeOf<typeof SpaceObjectState>;


export { SpaceObjectState }
