import { GetNextState } from "../Stateful";
import { SpaceObjectView } from "../TreeView";

export const ship: GetNextState<SpaceObjectView> = function({ state, nextState }) {
    nextState = nextState ?? state.factory();
    nextState.protobuf.shipState = state.protobuf.shipState;
    return nextState;
}

// export class Ship implements Stateful<SpaceObjectView> {
//     getNextState({ state, nextState }: { state: SpaceObjectView; nextState?: SpaceObjectView }): SpaceObjectView {

//         nextState = nextState ?? state.factory();
//         nextState.value.shipState = state.value.shipState;
//         return nextState;
//     }
// }
