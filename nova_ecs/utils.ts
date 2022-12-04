import { UnknownComponent } from "./component";
import { Sortable } from "./system";

export interface WithComponents {
    components: ReadonlyMap<UnknownComponent, unknown>;
}

export class DuplicateNameError extends Error {}

export function topologicalSortList(list: Sortable[]): Sortable[] {
    // Construct a graph with no edges.
    const graph = new Map<Sortable, Set<Sortable>>(
        list.map(val => [val, new Set()]));

    // Create a map to look up edges by reference or by name.
    const entries = new Map<Sortable | string, Sortable>(
        [...[...graph.keys()].map(key => [key, key] as const)]);

    for (const key of graph.keys()) {
        if (entries.has(key.name)) {
            throw new DuplicateNameError(`Duplicate name '${key.name}'`);
        }
        entries.set(key.name, key);
    }

    // Add all edges to the graph. Store directed edges from node A to B on node B.
    // Include the sortable itself and its name as mapping to the sortable
    for (const [sortable, incomingEdges] of graph) {
        // Add incoming edges to sortables that this sortable runs before.
        for (const before of sortable.before) {
            const beforeSortable = entries.get(before);
            if (beforeSortable) {
                const incomingBeforeEdges = graph.get(beforeSortable);
                // Ignore if the referenced node is not present in the graph.
                // This is fine because if it's not in the graph, then we can't
                // accidentally violate one of its order requirements.
                incomingBeforeEdges?.add(sortable)
            }
        }

        // Add incoming edges to this sortable from the sortables that it runs after.
        for (const after of sortable.after) {
            const afterSortable = entries.get(after);
            if (afterSortable) {
                incomingEdges.add(afterSortable);
            }
        }
    }

    return topologicalSort(graph);
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
    constructor(private factory: (key: K) => V, entries: Iterable<readonly [K, V]> = []) {
        super(entries);
    }

    override get(key: K): V {
        if (!super.has(key)) {
            super.set(key, this.factory(key));
        }
        return super.get(key)!;
    }
}

export function isPromise(p: unknown): p is Promise<unknown> {
    return typeof p !== 'undefined'
        && typeof (p as any).then === 'function';
}
