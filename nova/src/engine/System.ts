import { spaceObject } from "./space_object/SpaceObject";
import { GetNextState } from "./Stateful";
import { makeNextChildrenState } from "./StatefulMap";
import { ISystemView, SystemView } from "./TreeView";


const nextSpaceObjectsState = makeNextChildrenState(spaceObject);

export const system: GetNextState<ISystemView> = function({ state, nextState, delta }) {
    nextState = nextState ?? new SystemView();

    nextState.families.spaceObjects =
        nextSpaceObjectsState({
            state: state.families.spaceObjects,
            nextState: nextState.families.spaceObjects,
            delta
        });
    return nextState;
}
