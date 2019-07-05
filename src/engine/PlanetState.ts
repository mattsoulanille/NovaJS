import * as t from "io-ts";
import { SpaceObjectState } from "./SpaceObjectState";

const PlanetState = t.intersection([
    SpaceObjectState,
    t.type({})
]);


type PlanetState = t.TypeOf<typeof PlanetState>;

export { PlanetState }
