import produce, { enableMapSet } from "immer";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
//import { Display } from "./display/Display";
import { Engine } from "./engine/Engine";


export class GameLoop {
    //readonly display?: (engine: EngineState) => unknown;
    engine: Engine;
    ownedUUIDs = new Set<string>();
    //display: Display;

    constructor(gameData: GameDataInterface) {
        this.engine = new Engine([], gameData);
    }

    step(time: number): void {


        const deltaToSend = this.engine.step({ time, ownedUUIDs: this.ownedUUIDs });
    }
}
