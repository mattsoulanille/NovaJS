import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
import { SystemState } from "./SystemState";
import { Steppable } from "./Steppable";

import { Ship } from "./Ship";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { ShipState } from "./ShipState";
import { StatefulMap } from "./StatefulMap";
import { isEmptyObject } from "./EmptyObject";
import { getStateFromGetters, setStateFromSetters } from "./StateTraverser";


class System implements Stateful<SystemState>, Steppable {
    private ships: StatefulMap<Ship, ShipState>;
    private gameData: GameDataInterface;

    constructor({ gameData }: { gameData: GameDataInterface }) {
        this.gameData = gameData;
        this.ships = new StatefulMap();
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
}

export { System }
