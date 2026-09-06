import 'jasmine';
import { Marker, Sortable } from './system.js';
import { DefaultMap, setEqual, sortableNameOrder, subset, topologicalSort, topologicalSortList } from './utils.js';

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

        it('ignores incoming edges to nodes not in the graph', () => {
            // 'a' must come after 'missing', which is not a key in the graph.
            // The missing node can never be placed, so a naive check would
            // treat this as an unsatisfiable (cyclic) constraint and throw.
            // Instead the dangling edge should be ignored.
            const graph: Map<string, Set<string>> = new Map([
                ['a', new Set(['missing'])],
                ['b', new Set(['a'])],
            ]);

            let sorted: string[] = [];
            expect(() => { sorted = topologicalSort(graph); }).not.toThrow();
            // Both nodes are present and 'a' still comes before 'b'.
            expect(sorted.sort()).toEqual(['a', 'b']);
            expect(topologicalSort(graph).indexOf('a'))
                .toBeLessThan(topologicalSort(graph).indexOf('b'));
        });

        it('still throws for a cycle even when a dangling edge is present', () => {
            const graph: Map<string, Set<string>> = new Map([
                ['a', new Set(['b', 'missing'])],
                ['b', new Set(['a'])],
            ]);

            expect(() => topologicalSort(graph)).toThrowError('Graph contains a cycle');
        });

        it('throws for a self-edge', () => {
            const graph: Map<string, Set<string>> = new Map([
                ['a', new Set(['a'])],
            ]);
            expect(() => topologicalSort(graph)).toThrowError('Graph contains a cycle');
        });

        // #43: with a comparator, the order among ready nodes is the
        // comparator's, independent of Map insertion order.
        it('breaks ties by the comparator, not by insertion order', () => {
            const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
            const forward: Map<string, Set<string>> = new Map([
                ['c', new Set()], ['a', new Set()], ['b', new Set(['c'])],
            ]);
            const backward = new Map([...forward].reverse());
            expect(topologicalSort(forward, compare)).toEqual(['a', 'c', 'b']);
            expect(topologicalSort(backward, compare)).toEqual(['a', 'c', 'b']);
        });

        it('falls back to insertion order without a comparator', () => {
            const graph: Map<string, Set<string>> = new Map([
                ['c', new Set()], ['a', new Set()], ['b', new Set(['c'])],
            ]);
            expect(topologicalSort(graph)).toEqual(['c', 'a', 'b']);
        });
    });

    // #43: system order must be a well-defined function of its inputs.
    describe('topologicalSortList order', () => {
        function marker(name: string, edges: { before?: Sortable[], after?: Sortable[] } = {}) {
            return new Marker({ name, before: edges.before, after: edges.after });
        }
        const names = (list: Sortable[]) => list.map(s => s.name);

        it('keeps list order for unconstrained nodes by default', () => {
            const a = marker('A');
            const x = marker('X');
            const b = marker('B');
            expect(names(topologicalSortList([b, x, a]))).toEqual(['B', 'X', 'A']);
            expect(names(topologicalSortList([x, b, a]))).toEqual(['X', 'B', 'A']);
        });

        it('places a delayed node right after the constraint that delays it', () => {
            // The old pass-based sort gave [A, X, B] and, after adding
            // N{before: X}, [A, B, N, X]. The priority-queue sort gives
            // the same here, but by a stated rule (registration order
            // among ready nodes) rather than by pass structure.
            const a = marker('A');
            const x = marker('X');
            const b = marker('B');
            const n = marker('N', { before: [x] });
            expect(names(topologicalSortList([a, x, b]))).toEqual(['A', 'X', 'B']);
            expect(names(topologicalSortList([a, x, b, n]))).toEqual(['A', 'B', 'N', 'X']);
            // A node delayed by an edge to an EARLIER-registered node
            // stays in place.
            const m = marker('M', { before: [b] });
            expect(names(topologicalSortList([a, m, x, b]))).toEqual(['A', 'M', 'X', 'B']);
        });

        describe('with sortableNameOrder', () => {
            it('is independent of list order for unconstrained nodes', () => {
                const a = marker('A');
                const x = marker('X');
                const b = marker('B');
                const sorted = (list: Sortable[]) =>
                    names(topologicalSortList(list, sortableNameOrder));
                expect(sorted([a, x, b])).toEqual(['A', 'B', 'X']);
                expect(sorted([b, x, a])).toEqual(['A', 'B', 'X']);
                expect(sorted([x, b, a])).toEqual(['A', 'B', 'X']);
            });

            it('is idempotent and reversal-invariant', () => {
                const root = marker('root');
                const b1 = marker('b1');
                const a1 = marker('a1', { before: [b1], after: [root] });
                const a2 = marker('a2', { after: [root] });
                const c1 = marker('c1', { after: [root, b1] });
                const first = topologicalSortList([c1, root, b1, a1, a2], sortableNameOrder);
                expect(topologicalSortList(first, sortableNameOrder)).toEqual(first);
                expect(topologicalSortList([...first].reverse(), sortableNameOrder))
                    .toEqual(first);
            });

            it('orders unnamed markers after named ones, by list order among themselves', () => {
                const u1 = new Marker();
                const u2 = new Marker();
                const z = marker('Z');
                expect(topologicalSortList([u2, z, u1], sortableNameOrder))
                    .toEqual([z, u2, u1]);
            });
        });
    });
    describe('topologicalSortList', () => {
        it('topologically sorts a list of sortables', () => {
            const root: Sortable = new Marker(
                {name: 'root', before: new Set(), after: new Set()});
            const b1: Sortable = new Marker(
                {name: 'b1', before: new Set(), after: new Set()});
            const a1: Sortable = new Marker(
                {name: 'a1', before: new Set([b1]), after: new Set([root])});
            const a2: Sortable = new Marker(
                {name: 'a2', before: new Set(), after: new Set([root])});
            const c1: Sortable = new Marker(
                {name: 'c1', before: new Set(), after: new Set([root, b1])});

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
        // it('checks for name collisions', () => {
        //     const foo: Sortable =
        //         {name: 'foo', before: new Set(), after: new Set()};
        //     const alsoFoo: Sortable =
        //         {name: 'foo', before: new Set(), after: new Set()};

        //     expect(() => {
        //         topologicalSortList([foo, alsoFoo])
        //     }).toThrow(new DuplicateNameError('Duplicate name \'foo\''));
        // });
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

    describe('DefaultMap.cloneWith', () => {
        it('copies the entries through cloneValue', () => {
            const map = new DefaultMap<string, { n: number }>(() => ({ n: 0 }));
            map.get('a').n = 1;
            map.get('b').n = 2;

            const copy = map.cloneWith(v => ({ ...v }));

            expect([...copy]).toEqual([['a', { n: 1 }], ['b', { n: 2 }]]);
            expect(copy.get('a')).not.toBe(map.get('a'));
            copy.get('a').n = 5;
            expect(map.get('a').n).toBe(1);
        });

        it('keeps the default factory for keys the copy has not seen', () => {
            const map = new DefaultMap<string, number>(key => key.length);
            map.get('ab');

            const copy = map.cloneWith();

            expect(copy.get('xyz')).toBe(3);
            expect(map.has('xyz')).toBeFalse();
            expect(copy.get('ab')).toBe(2);
        });
    });
});
