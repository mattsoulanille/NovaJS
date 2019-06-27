import { GameState } from "./GameState";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { System } from "./System";
import { Stateful } from "./Stateful";
import { Steppable } from "./Steppable";
import { SystemState } from "./SystemState";
import { StatefulMap } from "./StatefulMap";

class MissingSystemError extends Error {
    constructor(system: string) {
        super("Missing system " + system)
    }
}

class Engine implements Stateful<GameState>, Steppable {
    private gameData: GameDataInterface;
    private systems: StatefulMap<System, SystemState>;
    private activeSystems: Set<string>;

    constructor({ gameData }: { gameData: GameDataInterface }) {
        this.gameData = gameData;
        this.systems = new Map();
        this.activeSystems = new Set();
    }

    step(milliseconds: number) {
        for (let systemID of this.activeSystems) {
            var system = this.systems.get(systemID);
            if (system === undefined) {
                throw new MissingSystemError(systemID);
            }
            system.step(milliseconds);
        }
    }

    // Serializes the current state of the game
    getState(): GameState {
        let state: GameState = { systems: {} };
        for (let [uuid, system] of this.systems) {
            state.systems[uuid] = system.getState()
        }
        return state;
    }

    // Set the current state of the game
    setState(_state: GameState) {

    }

}

export { Engine }
