import { Type } from "io-ts";

enum DeltaAction {
    SETREC,
    SETVAL,
    DELETE,
}

type DeltaEntry<T> = {
    action: DeltaAction.SETREC,
    value: T extends Object ? {
        [K in keyof T]?: DeltaEntry<T[K]>
    } : T
} | {
    action: DeltaAction.SETVAL,
    value: T,
} | {
    action: DeltaAction.DELETE,
}

function getDelta<State>(a: State, b: State): DeltaEntry<State> | null {
    if (!(a instanceof Object && b instanceof Object)) {
        if (typeof b === 'symbol') {
            throw new Error(`Cannot serialize symbol ${String(b)}`);
        }
        if (b instanceof Function) {
            throw new Error(`Cannot serialize function ${b}`);
        }

        if (a === b) {
            return null
        }

        return {
            action: DeltaAction.SETVAL,
            value: b
        }
    }

}

function applyDelta<State>(state: State, delta: DeltaEntry<State>): State {

}
