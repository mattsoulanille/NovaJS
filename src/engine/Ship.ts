import { ShipState } from "./ShipState";
import { SpaceObject } from "./SpaceObject";
import { Stateful, RecursivePartial } from "./Stateful";
import { GameDataInterface } from "novadatainterface/GameDataInterface";

class Ship extends SpaceObject implements Stateful<ShipState> {
    readonly gameData: GameDataInterface;
    constructor({ gameData, state }: { gameData: GameDataInterface, state: ShipState }) {
        super({ state });

        this.gameData = gameData;
    }
}




function makeShipFactory(gameData: GameDataInterface): (s: ShipState) => Ship {
    return function(state: ShipState) {
        return new Ship({ gameData, state });
    }
}

function fullShipState(maybeState: RecursivePartial<ShipState>): ShipState | undefined {
    let decoded = ShipState.decode(maybeState)
    if (decoded.isRight()) {
        return decoded.value
    }
    else {
        return undefined;
    }
}


export { Ship, makeShipFactory, fullShipState };
