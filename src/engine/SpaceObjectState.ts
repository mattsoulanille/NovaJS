import * as t from "io-ts";
import { VectorType } from "./Vector";
import { MovementType } from "./MovementType";
import { AngleType } from "./Angle";
import { NovaDataType } from "novadatainterface/NovaDataInterface";

const TurnDirection = t.union([
    t.literal(1),
    t.literal(0),
    t.literal(-1),
    t.literal("back")
]);
type TurnDirection = t.TypeOf<typeof TurnDirection>;

const SpaceObjectState =
    t.type({
        position: VectorType,
        velocity: VectorType,
        maxVelocity: t.number,
        rotation: AngleType,
        turning: TurnDirection,
        turnRate: t.number,
        movementType: MovementType,
        acceleration: t.number,
        accelerating: t.number,
        id: t.string // The ID for GameData. Not UUID.
    });


type SpaceObjectState = t.TypeOf<typeof SpaceObjectState>;


export { SpaceObjectState, TurnDirection }
