import * as t from "io-ts";
import { PlanetState } from "./PlanetState";
import { ShipState } from "./ShipState";



const SystemState = t.type({
    ships: t.record(t.string, ShipState),
    planets: t.record(t.string, PlanetState),
});



type SystemState = t.TypeOf<typeof SystemState>;

export { SystemState };
