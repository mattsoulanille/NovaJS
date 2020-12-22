import { Component } from "./component";

export interface WithComponents {
    components: ReadonlyMap<Component<unknown, unknown>, unknown>;
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
export function subset(a: Set<unknown>, b: Set<unknown>) {
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

export function setEqual(a: Set<unknown>, b: Set<unknown>) {
    return a === b || a.size === b.size && subset(a, b) && subset(b, a);
}
