import { GameState } from "./GameState";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { System, makeSystemFactory, fullSystemState } from "./System";
import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
import { Steppable } from "./Steppable";
import { SystemState } from "./SystemState";
import { StatefulMap } from "./StatefulMap";
import * as UUID from "uuid/v4";
import { BuildingMap } from "./BuildingMap";

class MissingSystemError extends Error {
    constructor(system: string) {
        super("Missing system " + system)
    }
}

class Engine implements Stateful<GameState>, Steppable {
    private gameData: GameDataInterface;
    private systems: BuildingMap<System, SystemState>;
    private activeSystems: Set<string>;
    private uuidFunction: () => string;

    constructor({ gameData, uuidFunction }: { gameData: GameDataInterface, uuidFunction?: () => string }) {
        this.uuidFunction = uuidFunction || UUID;
        this.gameData = gameData;


        this.systems = new BuildingMap<System, SystemState>(
            makeSystemFactory(this.gameData),
            fullSystemState
        );

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

    getSystemFullState(systemUUID: string): SystemState {
        let system = this.systems.get(systemUUID);
        if (system) {
            return system.getFullState();
        }
        else {
            throw Error("Unknown system " + systemUUID);
        }
    }

    // async setInitialState(): Promise<GameState> {
    //     const ids = await this.gameData.ids;
    //     const state: GameState = {
    //         systems: {}
    //     };

    //     for (let id of ids.System) {
    //         state.systems[id] = {
    //             ships: {},
    //             planets: {}
    //         }
    //     }
    //     this.setState(state);
    //     return state
    // }
}

export { Engine }
