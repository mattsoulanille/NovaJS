import * as t from "io-ts";
import { SpaceObjectState, SpaceObjectComparator } from "./SpaceObjectState";
import { makeComparator, combineComparators } from "./Comparator";

const PlanetState = t.intersection([
    SpaceObjectState,
    t.type({})
]);


type PlanetState = t.TypeOf<typeof PlanetState>;

const PlanetComparator = combineComparators(SpaceObjectComparator);

export { PlanetState, PlanetComparator }
