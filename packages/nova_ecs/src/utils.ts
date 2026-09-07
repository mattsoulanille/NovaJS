import { UnknownComponent } from "./component.js";
import { Sortable } from "./system.js";

export interface WithComponents {
    components: ReadonlyMap<UnknownComponent, unknown>;
}

export class DuplicateNameError extends Error {}

/**
 * Sorts sortables by their declared before/after edges. Among nodes
 * that are ready at the same time, `compare` decides (default: the
 * position in `list`), so the result is a pure function of `list`'s
 * order and the edges — see `topologicalSort` (#43).
 */
export function topologicalSortList(list: Sortable[],
    compare?: (a: Sortable, b: Sortable) => number): Sortable[] {
    // Construct a graph with no edges.
    const graph = new Map<Sortable, Set<Sortable>>(
        list.map(val => [val, new Set()]));

    // Create a map to look up edges by reference or by name.
    const entries = new Map<Sortable | string, Sortable>(
        [...[...graph.keys()].map(key => [key, key] as const)]);

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

    return topologicalSort(graph, compare);
}

/**
 * The World's tie-break for `topologicalSortList`: makes the order a
 * function of the sortable SET and the edges alone (independent of
 * registration order): by name, compared code unit by code unit (NOT
 * localeCompare, which is locale-dependent and so would differ between
 * peers). Unnamed markers sort after named ones; two unnamed (or
 * same-named) sortables fall through to the list-position tie-break.
 *
 * Adopted for the World in #156 once every pair of simulation systems
 * that could observe its order had a declared edge (ambiguities.ts
 * reports the ones that do not). Measured against the real game before
 * that (#43, at 7f4e013e), switching moved 140 of 144 systems and
 * failed three specs on orderings that held only by registration
 * order — which is why the edges had to come first.
 */
export function sortableNameOrder(a: Sortable, b: Sortable): number {
    if (a.name === undefined) {
        return b.name === undefined ? 0 : 1;
    }
    if (b.name === undefined) {
        return -1;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Topologically sort a directed graph stored as a map from nodes to incoming edges.
 *
 * Incoming edges that point to nodes which are not keys in the graph are
 * ignored. Such an edge can never be satisfied by placing the missing node
 * (it isn't in the output), and since it isn't in the graph it can't impose an
 * ordering constraint anyway. This matches how `topologicalSortList` treats
 * references to sortables that aren't present.
 *
 * Among the nodes that are ready at each step, the smallest by
 * `compare` goes next (Kahn's algorithm with a priority queue); ties —
 * and no `compare` at all — fall back to the Map's insertion index. So
 * the result is a pure function of (the Map's order, the edges, and
 * `compare`), with a well-defined rule for unconstrained pairs. The
 * old pass-based sort placed every ready node per pass instead, which
 * made an unconstrained pair's order depend on how the previous
 * partial results had been re-sorted (#43); `World` now sorts its
 * full registration list every time rather than its previous output
 * plus one node, so system order is a function of registration order
 * and declared edges only.
 */
export function topologicalSort<T>(graph: Map<T, Set<T>>,
    compare?: (a: T, b: T) => number): T[] {
    const index = new Map<T, number>();
    const outgoing = new Map<T, T[]>();
    for (const node of graph.keys()) {
        index.set(node, index.size);
        outgoing.set(node, []);
    }
    const order = (a: T, b: T) =>
        (compare?.(a, b) || 0) || index.get(a)! - index.get(b)!;

    // In-graph incoming edge counts; a self-edge is a cycle.
    const remaining = new Map<T, number>();
    for (const [node, incomingEdges] of graph) {
        let count = 0;
        for (const edge of incomingEdges) {
            if (graph.has(edge)) {
                count++;
                outgoing.get(edge)!.push(node);
            }
        }
        remaining.set(node, count);
    }

    const ready = new BinaryHeap<T>(order);
    for (const [node, count] of remaining) {
        if (count === 0) {
            ready.push(node);
        }
    }

    const sorted: T[] = [];
    while (ready.size > 0) {
        const node = ready.pop()!;
        sorted.push(node);
        for (const next of outgoing.get(node)!) {
            const count = remaining.get(next)! - 1;
            remaining.set(next, count);
            if (count === 0) {
                ready.push(next);
            }
        }
    }
    if (sorted.length < graph.size) {
        throw new Error('Graph contains a cycle');
    }
    return sorted;
}

/** Minimal binary min-heap for the priority-queue Kahn sort above. */
class BinaryHeap<T> {
    private items: T[] = [];
    constructor(private compare: (a: T, b: T) => number) { }

    get size() {
        return this.items.length;
    }

    push(item: T) {
        const items = this.items;
        items.push(item);
        let i = items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.compare(items[i]!, items[parent]!) >= 0) {
                break;
            }
            [items[i], items[parent]] = [items[parent]!, items[i]!];
            i = parent;
        }
    }

    pop(): T | undefined {
        const items = this.items;
        if (items.length === 0) {
            return undefined;
        }
        const top = items[0]!;
        const last = items.pop()!;
        if (items.length > 0) {
            items[0] = last;
            let i = 0;
            for (;;) {
                const left = 2 * i + 1;
                const right = left + 1;
                let smallest = i;
                if (left < items.length
                    && this.compare(items[left]!, items[smallest]!) < 0) {
                    smallest = left;
                }
                if (right < items.length
                    && this.compare(items[right]!, items[smallest]!) < 0) {
                    smallest = right;
                }
                if (smallest === i) {
                    break;
                }
                [items[i], items[smallest]] = [items[smallest]!, items[i]!];
                i = smallest;
            }
        }
        return top;
    }
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
    constructor(private readonly factory: (key: K) => V, entries: Iterable<readonly [K, V]> = []) {
        super(entries);
    }

    override get(key: K): V {
        if (!super.has(key)) {
            super.set(key, this.factory(key));
        }
        return super.get(key)!;
    }

    /**
     * A new DefaultMap with the same default factory, holding
     * `cloneValue` of each entry (identity by default, i.e. a shallow
     * copy). Missing keys in the copy get fresh defaults, not the
     * original's.
     */
    cloneWith(cloneValue: (value: V, key: K) => V = v => v): DefaultMap<K, V> {
        const copy = new DefaultMap<K, V>(this.factory);
        for (const [key, value] of this) {
            copy.set(key, cloneValue(value, key));
        }
        return copy;
    }
}

export function isPromise(p: unknown): p is Promise<unknown> {
    return typeof p !== 'undefined'
        && typeof (p as any).then === 'function';
}
