import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
import { SystemState } from "./SystemState";
import { Steppable } from "./Steppable";

import { Ship } from "./Ship";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { ShipState } from "./ShipState";
import { StatefulMap } from "./StatefulMap";


class System implements Stateful<SystemState>, Steppable {
    private ships: StatefulMap<Ship, ShipState>;
    private gameData: GameDataInterface;

    constructor({ gameData }: { gameData: GameDataInterface }) {
        this.gameData = gameData;
        this.ships = new StatefulMap();

    }

    step(_milliseconds: number): void {

    }

    getState(missing: StateIndexer<SystemState> = {}): RecursivePartial<SystemState> {
        return {
            ships: this.ships.getState(missing.ships),
            planets: {},
            uuid: "temporary"
        }
    }
    setState(_state: Partial<SystemState>): StateIndexer<SystemState> {
        return {}
    }

}

export { System }
