import { StepState } from "../Stateful";
import { SpaceObjectView } from "../TreeView";

export const planet: StepState<SpaceObjectView> = function({ state, nextState }) {
    nextState = nextState ?? state.factory();
    nextState.sharedData.planetState = state.sharedData.planetState;
    return nextState;
}
