import * as t from "io-ts";
import { VectorType } from "./Vector";
import { MovementType } from "./MovementType";
import { AngleType } from "./Angle";
import { NovaDataType } from "novadatainterface/NovaDataInterface";


const SpaceObjectState =
    t.type({
        position: VectorType,
        velocity: VectorType,
        rotation: AngleType,
        movementType: MovementType,
        id: t.string // The ID for GameData. Not UUID.
    });


type SpaceObjectState = t.TypeOf<typeof SpaceObjectState>;


export { SpaceObjectState }
