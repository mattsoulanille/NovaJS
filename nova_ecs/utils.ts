import { current, Draft, isDraft } from "immer";
import { UnknownComponent } from "./component";

export interface WithComponents {
    components: ReadonlyMap<UnknownComponent, unknown>;
}

export function currentIfDraft<T>(val: T | Draft<T>): T {
    if (isDraft(val)) {
        return current(val) as T;
    }
    return val as T;
}

/**
 * Topologically sort a directed graph stored as a map from nodes to incoming edges.
 */
export function topologicalSort<T>(graph: Map<T, Set<T>>): T[] {
    const usedNodes = new Set<T>();
    const sorted: T[] = [];

    while (sorted.length < graph.size) {
        const lastLength = sorted.length;
        for (const [node, incomingEdges] of graph) {
            // Skip nodes we've already added
            if (usedNodes.has(node)) {
                continue;
            }
            // Check if all nodes this node must come after are already in the list.
            if (subset(incomingEdges, usedNodes)) {
                sorted.push(node);
                usedNodes.add(node);
            }
        }
        if (sorted.length === lastLength) {
            throw new Error('Graph contains a cycle');
        }
    }

    return sorted;
}

// Returns true if a is a subset of b
export function subset(a: ReadonlySet<unknown>, b: ReadonlySet<unknown>) {
    if (a === b) {
        return true;
    }

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

export function setEqual(a: ReadonlySet<unknown>, b: ReadonlySet<unknown>) {
    return a === b || a.size === b.size && subset(a, b) && subset(b, a);
}

export function filterSet<T>(a: ReadonlySet<T>, f: (x: T) => boolean): Set<T> {
    return new Set([...a].filter(f));
}

// All elements of a that are not in b
export function setDifference<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
    return filterSet(a, function(x) {
        return !b.has(x);
    });
}

// All elements of a that are also in b
export function setIntersection<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
    return filterSet(a, function(x) {
        return b.has(x);
    });
}

export class DefaultMap<K, V> extends Map<K, V> {
    constructor(private factory: (key: K) => V, entries: Iterable<[K, V]> = []) {
        super(entries);
    }

    get(key: K): V {
        if (!super.has(key)) {
            super.set(key, this.factory(key));
        }
        return super.get(key)!;
    }
}
