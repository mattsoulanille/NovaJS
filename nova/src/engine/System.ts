import { SystemState } from "novajs/nova/src/proto/protobufjs_bundle";
import { spaceObject } from "./space_object/SpaceObject";
import { GetNextState } from "./Stateful";
import { makeNextChildrenState } from "./StatefulMap";
import { SystemView } from "./TreeView";


const nextSpaceObjectsState = makeNextChildrenState(spaceObject);

export const system: GetNextState<SystemView> = function({ state, nextState, delta }) {
    nextState = nextState ?? new SystemView();

    nextState.families.spaceObjects.setChildrenView(
        nextSpaceObjectsState({
            state: state.families.spaceObjects.getChildrenView(),
            nextState: nextState.families.spaceObjects.getChildrenView(),
            delta
        })
    )

    return nextState;
}


// export class System implements Stateful<SystemView> {

//     readonly spaceObjects = new StatefulMap(SpaceObjectFactory.spaceObjectFactory);

//     getNextState({ state, nextState, delta }:
//         { state: SystemView; nextState?: SystemView; delta: number; }): SystemView {

//         nextState = nextState ?? new SystemView(new SystemState());
//         nextState.families.spaceObjects.setChildrenView(
//             this.spaceObjects.getNextState({
//                 state: state.families.spaceObjects.getChildrenView(),
//                 nextState: nextState.families.spaceObjects.getChildrenView(),
//                 delta
//             }));

//         return nextState;
//     }

//     static factory(_view?: TreeView<ISystemState, SystemChildren>): System {
//         return new System();
//     }
//     /*
//         static async fromID(id: string, gameData: GameDataInterface, makeUUID: () => string = UUID): Promise<SystemState> {

//             const data = await gameData.data.System.get(id);

//             const systemState = new SystemState();
//             const planetsMap = systemState.getPlanetsMap();
//             const planetsKeys = new MapKeys();
//             const planetsKeyset = new MapKeys.KeySet();
//             planetsKeys.setKeyset(planetsKeyset);
//             systemState.setPlanetskeys(planetsKeys);

//             // Make sure the UUIDs match up with the
//             // server if you call this on the client!
//             for (let planetID of data.planets) {
//                 const uuid = makeUUID();
//                 planetsMap.set(
//                     uuid,
//                     await Planet.fromID(planetID, gameData));
//                 planetsKeyset.addKey(uuid);
//             }

//             // Empty keyset for ships
//             const shipsKeys = new MapKeys();
//             const shipsKeyset = new MapKeys.KeySet();
//             shipsKeys.setKeyset(shipsKeyset);
//             systemState.setShipskeys(shipsKeys);

//             return systemState;
//         }
//     */
// }
