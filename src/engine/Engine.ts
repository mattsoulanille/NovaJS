import { GameState } from "./GameState";
import { GameDataInterface } from "novadatainterface/GameDataInterface";

class Engine {
    private gameData: GameDataInterface;

    constructor(gameData: GameDataInterface) {
        this.gameData = gameData;
    }

    Step(state: GameState, _delta: number): GameState {
        // Does nothing right now.
        return state;
    }


}

export { Engine }
