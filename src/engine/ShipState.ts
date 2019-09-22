import * as t from "io-ts";
import { SpaceObjectState, SpaceObjectComparator } from "./SpaceObjectState";
import { makeComparator, valueComparator, combineComparators } from "./Comparator";


const ShipState = t.intersection([
    SpaceObjectState,
    t.type({})
]);

type ShipState = t.TypeOf<typeof ShipState>;

// It's only combining one comparator, but other ship-specific properties
// can be included by making another comparator and combining it here.

const ShipComparator = combineComparators<ShipState>(SpaceObjectComparator);

export { ShipState, ShipComparator }
