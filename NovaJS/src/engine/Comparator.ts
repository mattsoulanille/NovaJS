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

    return function(a: PartialState<T>, b: PartialState<T>): PartialState<T> | {} {

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

// sufficientDifference is a record whose values are functions corresponding
// to the keys of T. Each such function returns whether a difference in its
// corresponding key is sufficient to constitute a difference between the
// input objects to the comparator. This is useful, for example, when comparing
// positions. If velocity is zero a and b, then a difference in
// position constitutes a meaningful difference. Otherwise, a difference in position is ignored.
function sufficientDifferenceComparator<T extends Object>(
    comparator: Comparator<T>,
    sufficientDifference: { [key in keyof Partial<T>]:
        (a: PartialState<T>, b: PartialState<T>) => boolean
    } = {} as any): Comparator<T> {

    return function(a: PartialState<T>, b: PartialState<T>): PartialState<T> | {} {
        const diff = comparator(a, b);

        // Only check sufficientDifference if all keys of diff have
        // sufficientDifference handlers.
        const diffKeySet = new Set(Object.keys(diff));
        const sufficientDifferenceKeySet = new Set(Object.keys(sufficientDifference));

        if (Object.keys(sufficientDifference).length > 0 &&
            isSubset(diffKeySet, sufficientDifferenceKeySet)) {

            let sufficient = false
            for (let key in sufficientDifference) {
                let check = sufficientDifference[key];
                let diffItem = (diff as RecursivePartial<T>)[key as keyof RecursivePartial<T>];
                sufficient =
                    sufficient &&
                    (diffItem !== undefined) &&
                    check(a, b);
            }
            if (!sufficient) {
                return {};
            }
        }
        return diff
    }

}

// Returns if s1 is a subset of s2
// I should not have needed to write this.
function isSubset<A>(s1: Set<A>, s2: Set<A>): boolean {
    if (s1.size > s2.size) {
        return false;
    }

    for (let entry of s1) {
        if (!s2.has(entry)) {
            return false;
        }
    }
    return true;
}

// Overlap comparators that handle subsets of a type T into a comparator
// that handles their union. Comparators earlier in the arguments
// take precedence over those later in the arguments.
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


type RecordOf<T> = { [index: string]: T };
function makeRecordComparator<T>(comparator: Comparator<T>): Comparator<RecordOf<T>> {
    type R = RecordOf<T>;
    return function(a: PartialState<R>, b: PartialState<R>): PartialState<R> {
        const fullDiff: PartialState<R> = {};
        for (let key in b) {
            let aVal = a[key];
            if (aVal === undefined) {
                fullDiff[key] = b[key];
            }
            else {
                let diff = comparator(aVal, b[key] as RecursivePartial<T>);
                if (!isEmptyObject(diff)) {
                    fullDiff[key] = diff;
                }
            }
        }
        return fullDiff;
    }
}

// Never says there's any difference between a and b
function neverComparator<T>(_a: PartialState<T>, _b: PartialState<T>): PartialState<T> | {} {
    return {};
}

// Given a comparator, returns a new comparator that
// has the given properties omitted
function subtractFromComparator<T extends Object>(comparator: Comparator<T>, remove: Set<string>): Comparator<T> {
    return function(a: PartialState<T>, b: PartialState<T>): PartialState<T> | {} {
        let diff = comparator(a, b);

        // {} is an object IDK what typescript is so mad about
        for (let key in diff as Object) {
            if (remove.has(key)) {
                delete (diff as any)[key]
            }
        }
        return diff
    }
}

function allOrNothingComparator<T extends Object>(comparator: Comparator<T>): Comparator<T> {

    return function(a: PartialState<T>, b: PartialState<T>): PartialState<T> | {} {
        const diff = comparator(a, b);
        if (isEmptyObject(diff)) {
            return {};
        }
        else {
            return b;
        }
    }
}

export { Comparator, makeComparator, valueComparator, combineComparators, makeRecordComparator, neverComparator, subtractFromComparator, allOrNothingComparator, sufficientDifferenceComparator }
