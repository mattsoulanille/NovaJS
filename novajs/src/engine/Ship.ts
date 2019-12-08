import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { ShipState } from "./ShipState";
import { SpaceObject } from "./SpaceObject";
import { RecursivePartial, Stateful } from "./Stateful";
import { isRight } from "fp-ts/lib/Either";

class Ship extends SpaceObject implements Stateful<ShipState> {
    readonly gameData: GameDataInterface;
    constructor({ gameData, state }: { gameData: GameDataInterface, state: ShipState }) {
        super({ state });

        this.gameData = gameData;
    }


    static async fromID(id: string, gameData: GameDataInterface): Promise<ShipState> {
        const data = await gameData.data.Ship.get(id);
        return {
            accelerating: 0,
            acceleration: data.physics.acceleration,
            id: data.id,
            maxVelocity: data.physics.speed,
            movementType: "inertial",
            position: { x: 0, y: 0 },
            rotation: 0,
            turning: 0,
            turnBack: false,
            turnRate: data.physics.turnRate,
            velocity: { x: 0, y: 0 }
        };
    }

    static makeFactory(gameData: GameDataInterface): (s: ShipState) => Ship {
        return function(state: ShipState) {
            return new Ship({ gameData, state });
        }
    }

    static fullState(maybeState: RecursivePartial<ShipState>): ShipState | undefined {
        let decoded = ShipState.decode(maybeState)
        if (isRight(decoded)) {
            return decoded.right;
        }
        else {
            return undefined;
        }
    }
}



export { Ship };
