import { StepState } from "./Stateful";
import { makeNextChildrenState } from "./StatefulMap";
import { system } from "./System";
import { engineViewFactory, EngineView } from "./TreeView";


const nextSystemsState = makeNextChildrenState(system);

export const engine: StepState<EngineView> = function({ state, nextState, delta }) {

    nextState = nextState ?? engineViewFactory();

    nextState.families.systems =
        nextSystemsState({
            state: state.families.systems,
            nextState: nextState.families.systems,
            delta
        });

    return nextState;
}
