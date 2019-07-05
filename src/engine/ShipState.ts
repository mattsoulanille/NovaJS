import * as t from "io-ts";
import { SpaceObjectState } from "./SpaceObjectState";


const ShipState = t.intersection([
    SpaceObjectState,
    t.type({})
]);

type ShipState = t.TypeOf<typeof ShipState>;

export { ShipState }
