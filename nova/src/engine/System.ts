import { GameDataInterface } from "../../../novadatainterface/GameDataInterface";

import { Planet } from "./Planet";
import { Ship } from "./Ship";
import { Steppable } from "./Steppable";
import UUID from "uuid/v4";

import { SystemState } from "novajs/nova/src/proto/system_state_pb";
import { ShipState } from "novajs/nova/src/proto/ship_state_pb";
import { PlanetState } from "novajs/nova/src/proto/planet_state_pb";
import { Stateful } from "./Stateful";
import { getMapStatesToProto, setMapStates } from "./MapStates";


class System implements Stateful<SystemState>, Steppable {
    readonly ships: Map<string, Ship> = new Map();
    readonly planets: Map<string, Planet> = new Map();
    readonly shipFactory: (shipState: ShipState) => Ship;
    readonly planetFactory: (planetState: PlanetState) => Planet;

    private gameData: GameDataInterface;

    constructor({ gameData, state }: { gameData: GameDataInterface, state: SystemState }) {
        this.gameData = gameData;

        this.shipFactory = Ship.makeFactory(gameData);
        this.planetFactory = Planet.makeFactory(gameData);

        this.setState(state);
    }

    step(milliseconds: number): void {
        this.ships.forEach((ship) => ship.step(milliseconds));
        this.planets.forEach((planet) => planet.step(milliseconds));
    }

    getState(): SystemState {
        const systemState = new SystemState();

        getMapStatesToProto({
            fromMap: this.planets,
            toMap: systemState.getPlanetsMap(),
            addKey: (key) => systemState.addPlanetskeys(key)
        });

        getMapStatesToProto({
            fromMap: this.ships,
            toMap: systemState.getShipsMap(),
            addKey: (key) => systemState.addShipskeys(key)
        });

        return systemState;
    }

    setState(state: SystemState) {
        // Update planets
        setMapStates({
            objects: this.planets,
            states: state.getPlanetsMap(),
            keys: state.getPlanetskeysList(),
            factory: this.planetFactory
        });

        // Update ships
        setMapStates({
            objects: this.ships,
            states: state.getShipsMap(),
            keys: state.getShipskeysList(),
            factory: this.shipFactory
        });
    }

    static async fromID(id: string, gameData: GameDataInterface, makeUUID: () => string = UUID): Promise<SystemState> {

        const data = await gameData.data.System.get(id);

        const systemState = new SystemState();
        const planetsMap = systemState.getPlanetsMap();

        // Make sure the UUIDs match up with the
        // server if you call this on the client!
        for (let planetID of data.planets) {
            const uuid = makeUUID();
            planetsMap.set(
                uuid,
                await Planet.fromID(planetID, gameData));
            systemState.addPlanetskeys(uuid);
        }

        return systemState;
    }

    static makeFactory(gameData: GameDataInterface): (s: SystemState) => System {
        return function(state: SystemState) {
            return new System({ gameData, state });
        }
    }
}

export { System }
