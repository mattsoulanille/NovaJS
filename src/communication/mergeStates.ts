import { PartialState } from "../engine/Stateful";

// Merge and overwrite a with values from b
function mergeStates<T extends Object>(a: PartialState<T>, b: PartialState<T>) {
    for (let key in b) {
        if ((a as any)[key] instanceof Object &&
            (b as any)[key] instanceof Object) {
            mergeStates((a as any)[key], (b as any)[key]);
        }
        else {
            (a as any)[key] = (b as any)[key];
        }
    }
}


export { mergeStates }
