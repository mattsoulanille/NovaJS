import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
import { SystemState } from "./SystemState";
import { Steppable } from "./Steppable";

import { Ship } from "./Ship";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { ShipState } from "./ShipState";
import { StatefulMap } from "./StatefulMap";
import { isEmptyObject } from "./EmptyObject";
import { getStateFromGetters, setStateFromSetters } from "./StateTraverser";
import { PlanetState } from "./PlanetState";


class System implements Stateful<SystemState>, Steppable {
    private ships: StatefulMap<Ship, ShipState>;
    private gameData: GameDataInterface;
    private readonly id: string;

    constructor({ gameData, id }: { gameData: GameDataInterface, id: string }) {
        this.gameData = gameData;
        this.ships = new StatefulMap();
        this.id = id; // The id in gameData
    }

    step(milliseconds: number): void {
        this.ships.forEach((ship) => ship.step(milliseconds));
    }

    getState(toGet: StateIndexer<SystemState> = {}): RecursivePartial<SystemState> {

        return getStateFromGetters<SystemState>(toGet, {
            planets: (_toGet) => { return {} },
            ships: (ships) => this.ships.getState(ships)
        });
    }

    setState(state: Partial<SystemState>): StateIndexer<SystemState> {

        return setStateFromSetters<SystemState>(state, {
            planets: () => { },
            ships: (shipStates) => this.ships.setState(shipStates)
        });
    }

    private async getInitialState(): Promise<SystemState> {
        let planets: { [index: string]: PlanetState } = {};
        let systemData = await this.gameData.data.System.get(this.id);


        systemData.planets



        return {
            ships: {},
            planets: planets
        }
    }
}

export { System }
