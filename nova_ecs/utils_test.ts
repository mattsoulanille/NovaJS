import 'jasmine';
import { setEqual, subset, topologicalSort } from './utils';

describe('utils', () => {
    it('topologically sorts a graph', () => {
        const graph: Map<string, Set<string>> = new Map([
            ['c1', new Set(['root', 'b1'])],
            ['root', new Set()],
            ['b1', new Set(['a1'])],
            ['a1', new Set(['root'])],
            ['a2', new Set(['root'])],
        ]);

        const sorted = topologicalSort(graph);

        // For a given node in the sorted list, verify that each incoming
        // edge appears in the sorted list before the node.
        const followingNodes = new Set(sorted);
        for (const node of sorted) {
            followingNodes.delete(node);
            const edges = graph.get(node);
            expect(edges).toBeDefined();
            for (const incomingEdge of edges!) {
                expect(followingNodes.has(incomingEdge)).toBeFalse();
            }
        }
    });

    it('topologically sorts a large graph', () => {
        // Create a random DAG
        let dag: Array<[number, Set<number>]> = [];
        for (let node = 0; node < 1000; node++) {
            const incomingEdges = new Set<number>();
            for (let validEdge = 0; validEdge < node; validEdge++) {
                if (Math.random() < 0.1) {
                    incomingEdges.add(validEdge);
                }
            }
            dag.push([node, incomingEdges]);
        }

        // Randomly add the edges to the graph
        const graph = new Map(dag);
        while (dag.length > 0) {
            const index = Math.floor(Math.random() * dag.length);
            const element = dag[index];
            dag = [...dag.slice(0, index), ...dag.slice(index + 1)];
            graph.set(element[0], element[1]);
        }

        const sorted = topologicalSort(graph);

        // For a given node in the sorted list, verify that each incoming
        // edge appears in the sorted list before the node.
        const followingNodes = new Set(sorted);
        for (const node of sorted) {
            followingNodes.delete(node);
            const edges = graph.get(node);
            expect(edges).toBeDefined();
            for (const incomingEdge of edges!) {
                expect(followingNodes.has(incomingEdge)).toBeFalse();
            }
        }
    });

    it('throws an error if a cycle is found', () => {
        const graph: Map<string, Set<string>> = new Map([
            ['a', new Set(['b'])],
            ['b', new Set(['a'])],
        ]);

        expect(() => topologicalSort(graph)).toThrowError('Graph contains a cycle');
    });

    it('checks subset', () => {
        const a = new Set([1, 2, 3]);
        const b = new Set([2, 3]);
        const c = new Set([2, 3, 4]);

        expect(subset(a, b)).toBeFalse();
        expect(subset(b, a)).toBeTrue();
        expect(subset(a, new Set([...a]))).toBeTrue();
        expect(subset(b, c)).toBeTrue();
        expect(subset(b, a)).toBeTrue();
        expect(subset(c, a)).toBeFalse();
    });

    it('checks set equality', () => {
        const a = new Set([1, 2, 3]);
        const c = new Set([2, 3, 4]);

        expect(setEqual(a, new Set([...a]))).toBeTrue();
        expect(setEqual(c, new Set([...c]))).toBeTrue();
        expect(setEqual(a, c)).toBeFalse();
    });
});
