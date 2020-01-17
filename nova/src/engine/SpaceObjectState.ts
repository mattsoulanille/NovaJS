import * as t from "io-ts";
import { VectorType } from "./Vector";
import { MovementType } from "./MovementType";
import { AngleType } from "./Vector";
import { makeComparator, valueComparator, allOrNothingComparator, sufficientDifferenceComparator } from "./Comparator";
import { VectorComparator } from "./VectorState";
import { PartialState } from "./Stateful";

const TurnDirection = t.union([
    t.literal(1),
    t.literal(0),
    t.literal(-1),
]);
type TurnDirection = t.TypeOf<typeof TurnDirection>;

const SpaceObjectState =
    t.type({
        position: VectorType,
        velocity: VectorType,
        maxVelocity: t.number,
        rotation: AngleType,
        turning: TurnDirection,
        turnBack: t.boolean,
        turnRate: t.number,
        movementType: MovementType,
        acceleration: t.number,
        accelerating: t.number,
        id: t.string // The ID for GameData. Not UUID.
    });


type SpaceObjectState = t.TypeOf<typeof SpaceObjectState>;


// Note that this is specifically used for determining what
// state changes (if any) need to be sent to the other peers.
// As such, it omits things like position, velocity, and rotation from the
// comparison when velocity, acceleration, or turning are nonzero respectively.

const staticComparator = makeComparator<SpaceObjectState>({
    accelerating: valueComparator,
    acceleration: valueComparator,
    id: valueComparator,
    maxVelocity: valueComparator,
    movementType: valueComparator,
    position: VectorComparator,
    rotation: valueComparator,
    turnBack: valueComparator,
    turning: valueComparator,
    turnRate: valueComparator,
    velocity: VectorComparator
})


const ignoreMovement = sufficientDifferenceComparator<SpaceObjectState>(
    staticComparator,
    {
        position: function(a, _b) {
            return a.velocity !== undefined &&
                a.velocity.x === 0 &&
                a.velocity.y === 0
        },
        velocity: function(a, _b) {
            return a.acceleration !== undefined &&
                a.acceleration === 0;

        },
        rotation: function(a, _b) {
            return a.turning !== undefined &&
                a.turning === 0 &&
                a.turnBack !== undefined &&
                a.turnBack === false;
        }
    });



const SpaceObjectComparator = allOrNothingComparator(ignoreMovement);



export { SpaceObjectState, TurnDirection, SpaceObjectComparator }
