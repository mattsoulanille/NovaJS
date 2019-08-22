import { SpaceObject } from "./SpaceObject";
import { Stateful, RecursivePartial } from "./Stateful";
import { PlanetState } from "./PlanetState";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { PlanetData } from "novadatainterface/PlanetData";

class Planet extends SpaceObject implements Stateful<PlanetState> {
    readonly gameData: GameDataInterface;
    constructor({ gameData, state }: { gameData: GameDataInterface, state: PlanetState }) {
        super({ state });
        this.gameData = gameData;
    }

    static async fromID(id: string, gameData: GameDataInterface): Promise<PlanetState> {
        const data = await gameData.data.Planet.get(id);
        return {
            accelerating: 0,
            acceleration: 0,
            id: data.id,
            maxVelocity: 0,
            movementType: "stationary",
            position: { x: 0, y: 0 },
            rotation: 0,
            turning: 0,
            turnRate: 0,
            velocity: { x: 0, y: 0 }
        }
    }
    static makeFactory(gameData: GameDataInterface): (s: PlanetState) => Planet {
        return function(state: PlanetState) {
            return new Planet({ gameData, state });
        }
    }

    static fullState(maybeState: RecursivePartial<PlanetState>): PlanetState | undefined {
        let decoded = PlanetState.decode(maybeState)
        if (decoded.isRight()) {
            return decoded.value
        }
        else {
            return undefined;
        }
    }
}



export { Planet }
