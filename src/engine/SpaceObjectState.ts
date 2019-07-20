import * as t from "io-ts";
import { VectorType } from "./Vector";
import { MovementType } from "./MovementType";
import { AngleType } from "./Angle";


const SpaceObjectState =
    t.type({
        position: VectorType,
        velocity: VectorType,
        rotation: AngleType,
        movementType: MovementType
    });


type SpaceObjectState = t.TypeOf<typeof SpaceObjectState>;


export { SpaceObjectState }
