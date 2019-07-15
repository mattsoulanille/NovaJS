import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
import { SystemState } from "./SystemState";
import { Steppable } from "./Steppable";

import { Ship } from "./Ship";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { ShipState } from "./ShipState";
import { StatefulMap } from "./StatefulMap";
import { isEmptyObject } from "./EmptyObject";


class System implements Stateful<SystemState>, Steppable {
    private ships: StatefulMap<Ship, ShipState>;
    private gameData: GameDataInterface;

    constructor({ gameData }: { gameData: GameDataInterface }) {
        this.gameData = gameData;
        this.ships = new StatefulMap();

    }

    step(_milliseconds: number): void {

    }

    getState(toGet: StateIndexer<SystemState> = {}): RecursivePartial<SystemState> {
        const empty = isEmptyObject(toGet);
        const state: RecursivePartial<SystemState> = {};

        if (empty || "ships" in toGet) {
            state.ships = this.ships.getState(toGet.ships);
        }

        if (empty || "planets" in toGet) {
            state.planets = {};
        }

        return state
    }

    setState(state: Partial<SystemState>): StateIndexer<SystemState> {
        const missing: StateIndexer<SystemState> = {};
        if (state.ships !== undefined) {
            let res = this.ships.setState(state.ships);
            if (isEmptyObject(res)) {

            }

        }
        if (state.planets !== undefined) {
            // TODO: Planets
        }

        return missing
    }

}

export { System }
