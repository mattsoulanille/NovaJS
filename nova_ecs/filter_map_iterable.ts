
// export interface FilterMapIterable<T> extends Iterable<T> {
//     map<V>(f: (t: T) => V): FilterMapIterable<V>;
//     filter(f: (t: T) => boolean): FilterMapIterable<T>;
// }


function* map<A, B>(f: (a: A) => B, i: Iterable<A>) {
    for (let a of i) {
        yield f(a);
    }
}


type FilterFunc<T, S extends T> =
    ((value: T) => value is S) | ((value: T) => boolean);

function* filter<T, S extends T = T>(f: FilterFunc<T, S>, i: Iterable<T>) {
    for (let a of i) {
        if (f(a)) {
            yield a;
        }
    }
}

// [1, 2, 3].filter
// filter<S extends T>(predicate: (value: T, index: number, array: readonly T[]) => value is S, thisArg ?: any): S[];



export class FilterMapIterable<T> implements Iterable<T> {
    constructor(private iterable: Iterable<T>) { };

    map<V>(f: (t: T) => V): FilterMapIterable<V> {
        return new FilterMapIterable(map(f, this.iterable));
    }

    filter<S extends T = T>(f: ((t: T) => t is S) | ((t: T) => boolean)): FilterMapIterable<S> {
        return new FilterMapIterable(filter(f, this.iterable));
    }

    [Symbol.iterator](): Iterator<T, any, undefined> {
        return this.iterable[Symbol.iterator]();
    }
}

let v = new FilterMapIterable([1, 2, 3]).filter(x => x == 1);
let v2 = new FilterMapIterable([1, 2, 3]).filter((x): x is 1 => x == 1);
