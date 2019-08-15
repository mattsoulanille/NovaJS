import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
import { SystemState } from "./SystemState";
import { Steppable } from "./Steppable";

import { Ship, fullShipState, makeShipFactory } from "./Ship";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { ShipState } from "./ShipState";
import { StatefulMap } from "./StatefulMap";
import { isEmptyObject } from "./EmptyObject";
import { getStateFromGetters, setStateFromSetters } from "./StateTraverser";
import { PlanetState } from "./PlanetState";
import { BuildingMap } from "./BuildingMap";


class System implements Stateful<SystemState>, Steppable {
    readonly ships: BuildingMap<Ship, ShipState>;
    private gameData: GameDataInterface;
    readonly uuid: string;

    constructor({ gameData, state }: { gameData: GameDataInterface, state: SystemState }) {
        this.uuid = state.uuid;
        this.gameData = gameData;
        this.ships = new BuildingMap<Ship, ShipState>(
            makeShipFactory(this.gameData),
            fullShipState
        );

        this.setState(state);
    }

    step(milliseconds: number): void {
        this.ships.forEach((ship) => ship.step(milliseconds));
    }

    getState(toGet: StateIndexer<SystemState> = {}): RecursivePartial<SystemState> {

        return getStateFromGetters<SystemState>(toGet, {
            planets: (_toGet) => { return {} },
            ships: (ships) => this.ships.getState(ships),
            uuid: () => { return this.uuid }
        });
    }

    setState(state: Partial<SystemState>): StateIndexer<SystemState> {

        return setStateFromSetters<SystemState>(state, {
            planets: () => { },
            ships: (shipStates) => this.ships.setState(shipStates)
        });
    }

    getFullState(): SystemState {
        var state = this.getState({});
        var decoded = SystemState.decode(state);
        if (decoded.isLeft()) {
            throw decoded.value
        }
        else {
            return decoded.value;
        }
    }

    // private async getInitialState(): Promise<SystemState> {
    //     let planets: { [index: string]: PlanetState } = {};
    //     let systemData = await this.gameData.data.System.get(this.id);


    //     //systemData.planets



    //     return {
    //         uuid: "test",
    //         ships: {},
    //         planets: planets
    //     }
    // }
}

function makeSystemFactory(gameData: GameDataInterface): (s: SystemState) => System {
    return function(state: SystemState) {
        return new System({ gameData, state });
    }
}

function fullSystemState(maybeState: RecursivePartial<SystemState>): SystemState | undefined {
    let decoded = SystemState.decode(maybeState)
    if (decoded.isRight()) {
        return decoded.value
    }
    else {
        return undefined;
    }
}



export { System, makeSystemFactory, fullSystemState }
