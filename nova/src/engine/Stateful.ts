
export type GetNextState<T> = ({ state, nextState, delta }: { state: T, nextState?: T, delta: number }) => T;
export interface Stateful<T> {
    getNextState({ state, nextState, delta }: { state: T, nextState?: T, delta: number }): T;
    //getNextState: GetNextState<T>;
}

