import { spaceObject } from "./space_object/SpaceObject";
import { StepState } from "./Stateful";
import { makeNextChildrenState } from "./StatefulMap";
import { SystemView, systemViewFactory } from "./TreeView";

const nextSpaceObjectsState = makeNextChildrenState(spaceObject);

export const system: StepState<SystemView> = function({ state, nextState, delta }) {
    nextState = nextState ?? systemViewFactory();

    nextState.families.spaceObjects =
        nextSpaceObjectsState({
            state: state.families.spaceObjects,
            nextState: nextState.families.spaceObjects,
            delta
        });
    return nextState;
}
