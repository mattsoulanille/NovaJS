import { ShipState } from "./ShipState";
import { SpaceObject } from "./SpaceObject";
import { Stateful, RecursivePartial, PartialState } from "./Stateful";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { ShipData } from "novadatainterface/ShipData";

class Ship extends SpaceObject implements Stateful<ShipState> {
    readonly gameData: GameDataInterface;
    constructor({ gameData, state }: { gameData: GameDataInterface, state: ShipState }) {
        super({ state });

        this.gameData = gameData;
    }

    static fromGameData(data: ShipData): ShipState {
        return {
            accelerating: 0,
            acceleration: data.physics.acceleration,
            id: data.id,
            maxVelocity: data.physics.speed,
            movementType: "inertial",
            position: { x: 0, y: 0 },
            rotation: 0,
            turning: 0,
            turnRate: data.physics.turnRate,
            velocity: { x: 0, y: 0 }
        };
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
