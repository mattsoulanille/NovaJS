import * as t from "io-ts";
import { PlanetState } from "./PlanetState";
import { ShipState } from "./ShipState";
import { WithUUID } from "./WithUUID";



const SystemState = t.intersection([
    WithUUID,
    t.type({
        ships: t.record(t.string, ShipState),
        planets: t.record(t.string, PlanetState),
    })
]);
// Systems are not explicitly attached to IDs of system resources. The game engine just puts the correct planets in them.


type SystemState = t.TypeOf<typeof SystemState>;

export { SystemState };
