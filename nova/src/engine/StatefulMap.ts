import { Stateful, GetNextState } from "./Stateful";
import { ChildrenView, TreeView } from "./TreeView";


//export type MapState<State> = { [index: string]: State };

//type TreeViewValue<T extends TreeView> = T extends { value: (infer V) } ? V : never;



//export class StatefulMap<T extends Stateful<State>, State extends TreeView<V, C>, V, C extends string> extends Map<string, T> implements Stateful<ChildrenView<V>> {


export function makeNextChildrenState<T extends TreeView<V, C>, V, C extends string>(nextChildState: GetNextState<T>): GetNextState<ChildrenView<V, C, T>> {
    return function({ state, nextState, delta }) {
        nextState = nextState ?? state.factory();
        nextState.keySet = state.keySet;

        for (const [key, substate] of state.children) {
            const nextSubstate = nextChildState({
                state: substate,
                nextState: nextState.children.get(key),
                delta
            });
            nextState.children.set(key, nextSubstate);
        }
        return nextState;
    }
}

// export class StatefulMap<T extends Stateful<TreeView<V, C>>, V, C extends string> extends Map<string, T> implements Stateful<ChildrenView<V>> {
//     constructor(private factory: (view: TreeView<V, C>) => T) {
//         super();
//     }

//     getNextState({ state, nextState, delta }:
//         {
//             state: ChildrenView<V, C>;
//             nextState?: ChildrenView<V, C>;
//             delta: number;
//         }): ChildrenView<V, C> {

//         nextState = nextState ?? state.factory();
//         nextState.keySet = state.keySet;

//         for (const [key, substate] of state.children) {
//             if (!this.has(key)) {
//                 this.set(key, this.factory(substate));
//             }

//             nextState.children.set(key, this.get(key)!.getNextState({
//                 state: substate,
//                 nextState: nextState.children.get(key),
//                 delta,
//             }));
//         }

//         const keys = new Set(Object.keys(nextState));
//         for (const key of this.keys()) {
//             if (!keys.has(key)) {
//                 this.delete(key);
//             }
//         }
//         return nextState;
//     }
// }
