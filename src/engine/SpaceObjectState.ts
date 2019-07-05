import * as t from "io-ts";
import { VectorType } from "./Vector";
import { MovementType } from "./MovementType";
import { WithUUID } from "./WithUUID";


const SpaceObjectState = t.intersection([
    WithUUID,
    t.type({
        position: VectorType,
        velocity: VectorType,
        movementType: MovementType
    })
]);

type SpaceObjectState = t.TypeOf<typeof SpaceObjectState>;


export { SpaceObjectState }
