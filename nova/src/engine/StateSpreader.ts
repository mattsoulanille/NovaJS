import { Step } from "./State";

export function stateSpreader<T>(stateTransformers: Step<T>[]): Step<T> {
    return function({ state, delta }) {
        for (const transformer of stateTransformers) {
            transformer({ state, delta });
        }
    }
}
