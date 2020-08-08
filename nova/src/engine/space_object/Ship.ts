import { StepState } from "../Stateful";
import { SpaceObjectView } from "../TreeView";

export const ship: StepState<SpaceObjectView> = function({ state, nextState }) {
    nextState = nextState ?? state.factory();
    nextState.sharedData.shipState = state.sharedData.shipState;
    return nextState;
}
