export function setUnion<T>(a: Set<T>, b: Set<T>): Set<T> {
    return new Set([...a, ...b]);
}

function filterSet<T>(a: Set<T>, f: (x: T) => boolean): Set<T> {
    return new Set([...a].filter(f));
}

// All elements of a that are not in b
export function setDifference<T>(a: Set<T>, b: Set<T>): Set<T> {
    return filterSet(a, function(x) {
        return !b.has(x);
    });
}

// All elements of a that are also in b
export function setIntersection<T>(a: Set<T>, b: Set<T>): Set<T> {
    return filterSet(a, function(x) {
        return b.has(x);
    });
}
