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
