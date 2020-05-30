import { GetNextState } from "./Stateful";
import { makeNextChildrenState } from "./StatefulMap";
import { system } from "./System";
import { EngineView } from "./TreeView";


const nextSystemsState = makeNextChildrenState(system);

export const engine: GetNextState<EngineView> = function({ state, nextState, delta }) {

    nextState = nextState ?? new EngineView();

    nextState.families.systems =
        nextSystemsState({
            state: state.families.systems,
            nextState: nextState.families.systems,
            delta
        });

    return nextState;
}
