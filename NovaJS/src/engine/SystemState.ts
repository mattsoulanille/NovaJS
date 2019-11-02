import * as t from "io-ts";
import { PlanetState, PlanetComparator } from "./PlanetState";
import { ShipState, ShipComparator } from "./ShipState";
import { WithUUID } from "./WithUUID";
import { makeComparator, makeRecordComparator } from "./Comparator";



const SystemState =
    t.type({
        ships: t.record(t.string, ShipState),
        planets: t.record(t.string, PlanetState),
    });



// Systems are not explicitly attached to IDs of system resources. The game engine just puts the correct planets in them.


type SystemState = t.TypeOf<typeof SystemState>;

const SystemComparator = makeComparator<SystemState>({
    planets: makeRecordComparator(PlanetComparator),
    ships: makeRecordComparator(ShipComparator)
})


export { SystemState, SystemComparator };
