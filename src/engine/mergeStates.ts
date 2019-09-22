import { PartialState } from "../engine/Stateful";

// Merge and overwrite a with values from b
function mergeStates<T extends Object>(a: PartialState<T>, b: PartialState<T>) {
    for (let key in b) {
        if (a[key] instanceof Object &&
            b[key] instanceof Object) {
            mergeStates((a as any)[key], b[key]);
        }
        else {
            a[key] = b[key];
        }
    }
}


export { mergeStates }
