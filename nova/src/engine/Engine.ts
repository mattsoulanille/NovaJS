import { SystemState } from "novajs/nova/src/proto/system_state_pb";
import { EngineState } from "novajs/nova/src/proto/engine_state_pb";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import UUID from "uuid/v4";
import { getMapStatesToProto, setMapStates } from "./MapStates";
import { Stateful } from "./Stateful";
import { Steppable } from "./Steppable";
import { System } from "./System";



// class SystemMissingError extends Error {
//     constructor(system: string) {
//         super("Missing system " + system)
//     }
// }
// class ShipMissingError extends Error {
//     constructor(ship: string) {
//         super("Missing ship " + ship);
//     }
// }

export class Engine implements Stateful<EngineState>, Steppable {
    private gameData: GameDataInterface;
    private systems: Map<string, System> = new Map();

    readonly activeSystems: Set<string>;
    //readonly activeShips: Set<string>;
    readonly uuidFunction: () => string;
    readonly systemFactory: (systemState: SystemState) => System;

    constructor({ gameData, state, uuidFunction }: { gameData: GameDataInterface, state?: EngineState, uuidFunction?: () => string }) {
        this.uuidFunction = uuidFunction || UUID;
        this.gameData = gameData;

        this.systemFactory = System.makeFactory(this.gameData);

        this.activeSystems = new Set();

        if (state) {
            this.setState(state);
        }

    }

    step(milliseconds: number) {
        // TODO: Active systems
        //for (let systemID of this.activeSystems) {
        for (const system of this.systems.values()) {
            system.step(milliseconds);
        }
    }

    // Serializes the current state of the game
    getState(): EngineState {
        const engineState = new EngineState();
        getMapStatesToProto({
            fromMap: this.systems,
            toMap: engineState.getSystemsMap(),
            addKey: (key) => engineState.addSystemskeys(key)
        });

        return engineState;
    }

    // Set the current state of the game
    setState(state: EngineState) {
        setMapStates({
            objects: this.systems,
            states: state.getSystemsMap(),
            keys: state.getSystemskeysList(),
            factory: this.systemFactory
        });
    }

    // private searchForShipSystem(shipUUID: string): string {
    //     for (let systemUUID of this.systems.keys()) {
    //         let system = this.systems.get(systemUUID);
    //         if (system === undefined) {
    //             throw new Error("Impossible");
    //         }
    //         let ship = system.ships.get(shipUUID)
    //         if (ship !== undefined) {
    //             this.shipSystemMap.set(shipUUID, systemUUID);
    //             return systemUUID;
    //         }
    //     }
    //     throw new ShipMissingError(shipUUID);
    // }

    // getShipSystemID(shipUUID: string): string {
    //     const possibleSystemUUID = this.shipSystemMap.get(shipUUID);
    //     if (possibleSystemUUID === undefined) {
    //         return this.searchForShipSystem(shipUUID);
    //     }
    //     else {
    //         const possibleSystem = this.systems.get(possibleSystemUUID);
    //         if (possibleSystem === undefined) {
    //             return this.searchForShipSystem(shipUUID);
    //         }
    //         else {
    //             const possibleShip = possibleSystem.ships.get(shipUUID);
    //             if (possibleShip === undefined) {
    //                 return this.searchForShipSystem(shipUUID);
    //             }
    //             else {
    //                 return possibleSystemUUID;
    //             }

    //         }
    //     }

    // }

    // private getShipSystem(shipUUID: string): System {
    //     // This key is known to have a corresponding value in this.systems.
    //     // See getShipSystemID.
    //     return (this.systems.get(this.getShipSystemID(shipUUID)) as System);
    // }

    // private getShip(shipUUID: string): Ship {
    //     // Known to either be defined or to have thrown an error. See getShipSystem.
    //     return this.getShipSystem(shipUUID).ships.get(shipUUID) as Ship;
    // }


    // // Set the state of a ship
    // setShipState(shipUUID: string, shipState: PartialState<ShipState>) {
    //     const ship = this.getShip(shipUUID);
    //     ship.setState(shipState);
    // }

    // // Create a new ship in the specified system
    // newShipInSystem(shipState: ShipState, systemID: string): string {
    //     const shipUUID = this.uuidFunction();

    //     this.setState({
    //         systems: {
    //             [systemID]: {
    //                 ships: {
    //                     [shipUUID]: shipState
    //                 }
    //             }
    //         }
    //     });
    //     return shipUUID;
    // }

    static async fromGameData(gameData: GameDataInterface): Promise<Engine> {
        const systemIDs = (await gameData.ids).System;

        const state = new EngineState();
        const systemsMap = state.getSystemsMap();
        // Only a single instance of a system ever exists, so we use
        // their resource ids instead of generating UUIDs for them.
        // If this ever changes, just use an RNG seeded by the
        // resource ID to generate multiple instance IDs per system.
        for (const id of systemIDs) {
            systemsMap.set(id, await System.fromID(id, gameData));
            state.addSystemskeys(id);
        }

        return new Engine({
            state,
            gameData
        });
    }
}
