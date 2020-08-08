import { Stateful } from "./Stateful";


export function copyState<T>(fromState: T, toState: T, keys: Iterable<keyof T>, overwrite = false) {
    for (const key of keys) {
        if (overwrite) {
            toState[key] = fromState[key];
        } else {
            toState[key] = toState[key] ?? fromState[key];
        }
    }
}


export class CopyState<T> implements Stateful<T> {

    stepState({ state, nextState }:
        { state: T; nextState: T; delta: number; }): T {
        // NOTE: This is not necessarily true since state may
        // have more keys than appear in its interface, such as
        // private methods and runtime-generated stuff.
        const allKeys = new Set(Object.keys(state)) as Set<keyof T>;

        copyState<T>(state, nextState, allKeys);
        return nextState;
    }
}
