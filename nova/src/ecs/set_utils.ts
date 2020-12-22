// Returns true if a is a subset of b
export function subset(a: Set<unknown>, b: Set<unknown>) {
    if (a.size > b.size) {
        return false;
    }

    for (const element of a) {
        if (!b.has(element)) {
            return false;
        }
    }
    return true;
}

export function setEqual(a: Set<unknown>, b: Set<unknown>) {
    return a.size === b.size && subset(a, b) && subset(b, a);
}
