
export type StepState<T> = ({ state, nextState, delta }: { state: T, nextState?: T, delta: number }) => T;
export interface Stateful<T> {
    stepState({ state, nextState, delta }: { state: T, nextState?: T, delta: number }): T;
    //getNextState: GetNextState<T>;
}

