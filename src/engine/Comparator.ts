import { PartialState, RecursivePartial } from "./Stateful";
import { mergeStates } from "./mergeStates";
import { isEmptyObject } from "./EmptyObject";


// // Returns a partial state that includes anything in `b` that is different from
// // the corresponding thing in `a`. Includes only keys present in `b`.
// function stateDiff<T extends Object>(a: PartialState<T>, b: PartialState<T>): PartialState<T> {
//     const diff: PartialState<T> = {};
//     for (let [key, val] of Object.entries(a)) {
//         if (val instanceof Object) {

//         }
//     }
// }


type Comparator<T> = (a: PartialState<T>, b: PartialState<T>) => PartialState<T> | {};

// Returns a function that compares objects of type PartialState<T>
// and returns another PartialState<T> object representing the asymmetric diff.
// Given objects `a` and `b`, it returns an object `c` where,
// for each property of `b`, it has the result of calling the comparison
// function between the corresponding property of `a` and that property of `b`
// unless `a` does not have that property, in which case `c` just gets
// the property of `b`.
function makeComparator<T extends Object>(
    comparators: { [key in keyof Partial<T>]:
        Comparator<T[key]>
    }): Comparator<T> {

    return function(a: PartialState<T>, b: PartialState<T>): PartialState<T> {

        const diff: PartialState<T> = {} as any; // Not sure why this is necessary

        for (let [_key, comparator] of Object.entries(comparators)) {

            // I don't know why this type information is not preserved.
            // _key is definitely `keyof PartialState<T>`;
            let key = _key as keyof PartialState<T>;

            if (b[key] === undefined) {
                continue;
            }

            if (a[key] === undefined) {
                diff[key] = b[key];
                continue;
            }

            // Now we know that both `a` and `b` have the key
            // {} means no difference between objects.
            let difference = comparator(a[key], b[key]);
            if (!isEmptyObject(difference)) {
                diff[key] = difference;
            }

        }
        return diff;
    }
}

// Combine comparators that handle subsets of a type T into a comparator
// that handles their union.
function combineComparators<T extends Object>(...comparators: Comparator<T>[]): Comparator<T> {
    const combined: Comparator<T> = function(a, b) {
        let combinedDiff: PartialState<T> = {} as any;
        for (let comparator of comparators) {
            let diff = comparator(a, b);

            // Since T extends Object, {} is also RecursivePartial<T>
            for (let key in diff as RecursivePartial<T>) {
                if (combinedDiff[key] === undefined) {
                    combinedDiff[key] = (diff as RecursivePartial<T>)[key];
                }
            }

        }
        return combinedDiff;
    }
    return combined;
}

// I don't know how to make this explicitly have the type Comparator<T>
function valueComparator<T>(a: PartialState<T>, b: PartialState<T>): PartialState<T> | {} {
    if (a === b) {
        return {}
    }
    else {
        return b;
    }
}

export { Comparator, makeComparator, valueComparator, combineComparators }
