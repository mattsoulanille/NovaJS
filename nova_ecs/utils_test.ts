import 'jasmine';
import { Sortable } from './system';
import { DuplicateNameError, setEqual, subset, topologicalSort, topologicalSortList } from './utils';

describe('utils', () => {
    describe('topologicalSort', () => {
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
    });
    describe('topologicalSortList', () => {
        it('topologically sorts a list of sortables', () => {
            const root: Sortable =
                {name: 'root', before: new Set(), after: new Set()};
            const b1: Sortable =
                {name: 'b1', before: new Set(), after: new Set()};
            const a1: Sortable =
                {name: 'a1', before: new Set([b1]), after: new Set([root])};
            const a2: Sortable =
                {name: 'a2', before: new Set(), after: new Set([root])};
            const c1: Sortable =
                {name: 'c1', before: new Set(), after: new Set([root, b1])};

            const list: Sortable[] = [c1, root, b1, a1, a2];
            const sorted = topologicalSortList(list);

            for (let i = 0; i < sorted.length; i++) {
                const val = sorted[i];
                const beforeVal = new Set(sorted.slice(0, i));
                const afterVal = new Set(sorted.slice(i + 1));

                for (const b of val.before) {
                    // val should not be after any sortables that it lists
                    // itself as before.
                    expect(beforeVal).not.toContain(b);
                }

                for (const a of val.after) {
                    // val should not be before any sortables that it lists
                    // itself as after.
                    expect(afterVal).not.toContain(a);
                }
            }
        });
        it('checks for name collisions', () => {
            const foo: Sortable =
                {name: 'foo', before: new Set(), after: new Set()};
            const alsoFoo: Sortable =
                {name: 'foo', before: new Set(), after: new Set()};

            expect(() => {
                topologicalSortList([foo, alsoFoo])
            }).toThrow(new DuplicateNameError('Duplicate name \'foo\''));
        });
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
