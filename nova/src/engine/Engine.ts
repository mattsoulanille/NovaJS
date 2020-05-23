import { makeNextChildrenState } from "./StatefulMap";
import { system } from "./System";
import { GetNextState } from "./Stateful";
import { EngineView } from "./TreeView";


const nextSystemsState = makeNextChildrenState(system);

export const engine: GetNextState<EngineView> = function({ state, nextState, delta }) {

    nextState = nextState ?? new EngineView();

    nextState.families.systems.setChildrenView(
        nextSystemsState({
            state: state.families.systems.getChildrenView(),
            nextState: nextState.families.systems.getChildrenView(),
            delta
        })
    );

    return nextState;
}


// export class Engine implements Stateful<EngineView> {
//     readonly systems = new StatefulMap(System.factory);
//     //readonly activeSystems = new Set<string>();

//     getNextState({ state, nextState, delta }:
//         { state: EngineView; nextState?: EngineView; delta: number; }): EngineView {

//         nextState = nextState ?? new EngineView(new EngineState());
//         nextState.families.systems.setChildrenView(this.systems.getNextState({
//             state: state.families.systems.getChildrenView(),
//             nextState: nextState.families.systems.getChildrenView(),
//             delta
//         }));

//         return nextState;
//     }



//     // private searchForShipSystem(shipUUID: string): string {
//     //     for (let systemUUID of this.systems.keys()) {
//     //         let system = this.systems.get(systemUUID);
//     //         if (system === undefined) {
//     //             throw new Error("Impossible");
//     //         }
//     //         let ship = system.ships.get(shipUUID)
//     //         if (ship !== undefined) {
//     //             this.shipSystemMap.set(shipUUID, systemUUID);
//     //             return systemUUID;
//     //         }
//     //     }
//     //     throw new ShipMissingError(shipUUID);
//     // }

//     // getShipSystemID(shipUUID: string): string {
//     //     const possibleSystemUUID = this.shipSystemMap.get(shipUUID);
//     //     if (possibleSystemUUID === undefined) {
//     //         return this.searchForShipSystem(shipUUID);
//     //     }
//     //     else {
//     //         const possibleSystem = this.systems.get(possibleSystemUUID);
//     //         if (possibleSystem === undefined) {
//     //             return this.searchForShipSystem(shipUUID);
//     //         }
//     //         else {
//     //             const possibleShip = possibleSystem.ships.get(shipUUID);
//     //             if (possibleShip === undefined) {
//     //                 return this.searchForShipSystem(shipUUID);
//     //             }
//     //             else {
//     //                 return possibleSystemUUID;
//     //             }

//     //         }
//     //     }

//     // }

//     // private getShipSystem(shipUUID: string): System {
//     //     // This key is known to have a corresponding value in this.systems.
//     //     // See getShipSystemID.
//     //     return (this.systems.get(this.getShipSystemID(shipUUID)) as System);
//     // }

//     // private getShip(shipUUID: string): Ship {
//     //     // Known to either be defined or to have thrown an error. See getShipSystem.
//     //     return this.getShipSystem(shipUUID).ships.get(shipUUID) as Ship;
//     // }


//     // // Set the state of a ship
//     // setShipState(shipUUID: string, shipState: PartialState<ShipState>) {
//     //     const ship = this.getShip(shipUUID);
//     //     ship.setState(shipState);
//     // }

//     // // Create a new ship in the specified system
//     // newShipInSystem(shipState: ShipState, systemID: string): string {
//     //     const shipUUID = this.uuidFunction();

//     //     this.setState({
//     //         systems: {
//     //             [systemID]: {
//     //                 ships: {
//     //                     [shipUUID]: shipState
//     //                 }
//     //             }
//     //         }
//     //     });
//     //     return shipUUID;
//     // }

//     // static async fromGameData(gameData: GameDataInterface): Promise<Engine> {
//     //     const systemIDs = (await gameData.ids).System;

//     //     const state = new EngineState();
//     //     const systemsMap = state.getSystemsMap();
//     //     // Only a single instance of a system ever exists, so we use
//     //     // their resource ids instead of generating UUIDs for them.
//     //     // If this ever changes, just use an RNG seeded by the
//     //     // resource ID to generate multiple instance IDs per system.
//     //     for (const id of systemIDs) {
//     //         systemsMap.set(id, await System.fromID(id, gameData));
//     //         //state.addSystemskeys(id);
//     //     }

//     //     return new Engine({
//     //         state,
//     //         gameData
//     //     });
//     // }
// }
