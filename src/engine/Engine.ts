import { GameState } from "./GameState";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { System } from "./System";
import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
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
        this.systems = new StatefulMap<System, SystemState>();
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
    getState(toGet: StateIndexer<GameState> = {}): RecursivePartial<GameState> {
        return {
            systems: this.systems.getState(toGet.systems)
        };
    }

    // Set the current state of the game
    setState(state: RecursivePartial<GameState>): StateIndexer<GameState> {
        const missing: StateIndexer<GameState> = {};

        if (state.systems) {
            missing.systems = this.systems.setState(state.systems);
        }

        return missing;

    }

}

export { Engine }
