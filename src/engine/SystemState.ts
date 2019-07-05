import * as t from "io-ts";
import { ShipState } from "./ShipState";
import { WithUUID } from "./WithUUID";
import { PlanetState } from "./PlanetState";



const SystemState = t.intersection([
    WithUUID,
    t.type({
        ships: t.record(t.string, ShipState),
        planets: t.record(t.string, PlanetState)
    })
]);


type SystemState = t.TypeOf<typeof SystemState>;

export { SystemState }
