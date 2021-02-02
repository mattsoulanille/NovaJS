import { Step } from "./State";

// Currying would be nice
// Monads (or functors) would be nicer
export function makeMapStepFunction<Val>(step: Step<Val>): Step<Map<string, Val>> {
    return function({ state, delta }) {
        for (const val of state.values()) {
            step({ state: val, delta });
        }
    }
}
