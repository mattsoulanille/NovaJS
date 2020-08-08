import { StepState } from "./Stateful";

export function stateSpreader<T>(stateTransformers: StepState<T>[], emptyStateFactory: () => T): StepState<T> {
    return function({ state, nextState, delta }) {
        nextState = nextState ?? emptyStateFactory();
        for (const transformer of stateTransformers) {
            nextState = transformer({
                state, nextState, delta
            });
        }
        return nextState;
    }
}


// export class StateSpreader<T> implements Stateful<T> {
//     constructor(private stateTransformers: Array<Stateful<T>>,
//         private emptyStateFactory: () => T) { }

//     getNextState({ state, nextState, delta }:
//         { state: T, nextState?: T, delta: number; }): T {
//         nextState = nextState ?? this.emptyStateFactory();
//         for (const transformer of this.stateTransformers) {
//             nextState = transformer.getNextState({
//                 state, nextState, delta
//             });
//         }
//         return nextState;
//     }
// }
