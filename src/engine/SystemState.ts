import { ShipState } from "./ShipState";
import { WithUUID } from "./WithUUID";
import { PlanetState } from "./PlanetState";


type SystemState = WithUUID & {

    ships: { [index: string]: ShipState }, // index: UUID
    planets: { [index: string]: PlanetState } // index: UUID

}

export { SystemState }
