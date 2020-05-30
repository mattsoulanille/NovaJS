import { GetNextState } from "../Stateful";
import { SpaceObjectView } from "../TreeView";

export const planet: GetNextState<SpaceObjectView> = function({ state, nextState }) {
    nextState = nextState ?? state.factory();
    nextState.protobuf.planetState = state.protobuf.planetState;
    return nextState;
}


// export class Planet implements Stateful<SpaceObjectView> {
//     getNextState({ state, nextState }: { state: SpaceObjectView; nextState?: SpaceObjectView }): SpaceObjectView {

//         nextState = nextState ?? state.factory();
//         nextState.value.planetState = state.value.planetState;
//         return nextState;
//     }
// }
