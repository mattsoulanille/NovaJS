import 'jasmine';
import {
    adjacentSystems,
    buildAdjacency,
    canPin,
    cycleSingle,
    effectiveRoute,
    expandRoute,
    formatMapDate,
    hazardDescription,
    reconcileRouteState,
    shortestPath,
    togglePin,
} from './route.js';

// A small test galaxy:
//   a - b - c - d
//       |
//       e - f
// (undirected links, listed both ways in the data)
const SYSTEMS = [
    { id: 'a', links: ['b'] },
    { id: 'b', links: ['a', 'c', 'e'] },
    { id: 'c', links: ['b', 'd'] },
    { id: 'd', links: ['c'] },
    { id: 'e', links: ['b', 'f'] },
    { id: 'f', links: ['e'] },
    // Isolated system with a link to a system that does not exist.
    { id: 'z', links: ['missing'] },
];
const adj = buildAdjacency(SYSTEMS);

describe('buildAdjacency', () => {
    it('drops links to unknown systems', () => {
        expect(adj.get('z')).toEqual([]);
    });
    it('keeps links to known systems', () => {
        expect(adj.get('b')).toEqual(['a', 'c', 'e']);
    });
});

describe('shortestPath', () => {
    it('returns [] for the same system', () => {
        expect(shortestPath(adj, 'a', 'a')).toEqual([]);
    });
    it('excludes the start and includes the destination', () => {
        expect(shortestPath(adj, 'a', 'd')).toEqual(['b', 'c', 'd']);
    });
    it('finds the branch path', () => {
        expect(shortestPath(adj, 'a', 'f')).toEqual(['b', 'e', 'f']);
    });
    it('returns null when unreachable', () => {
        expect(shortestPath(adj, 'a', 'z')).toBeNull();
    });
});

describe('togglePin', () => {
    it('appends a system that is not pinned', () => {
        expect(togglePin(['a'], 'b')).toEqual(['a', 'b']);
    });
    it('removes a system that is already pinned', () => {
        expect(togglePin(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    });
    it('does not mutate its input', () => {
        const input = ['a'];
        togglePin(input, 'b');
        expect(input).toEqual(['a']);
    });
});

describe('expandRoute (auto-fill between pins)', () => {
    it('is empty with no pins', () => {
        expect(expandRoute(adj, 'a', [])).toEqual([]);
    });
    it('fills the gap from current to a single far pin', () => {
        expect(expandRoute(adj, 'a', ['d'])).toEqual(['b', 'c', 'd']);
    });
    it('always includes every reachable pin, filling gaps between them',
        () => {
            // Pin d then f: a->..->d, then d->..->f.
            const route = expandRoute(adj, 'a', ['d', 'f']);
            expect(route).toEqual(['b', 'c', 'd', 'c', 'b', 'e', 'f']);
            expect(route).toContain('d');
            expect(route).toContain('f');
        });
    it('skips a pin equal to the current anchor', () => {
        expect(expandRoute(adj, 'a', ['a', 'b'])).toEqual(['b']);
    });
    it('skips an unreachable pin (adjacency contract) and keeps routing ' +
        'later pins from the previous anchor', () => {
            expect(expandRoute(adj, 'a', ['z', 'c'])).toEqual(['b', 'c']);
        });
    it('emits only adjacent consecutive hops (jump staging contract)', () => {
        const route = expandRoute(adj, 'a', ['d', 'z', 'f']);
        let prev = 'a';
        for (const hop of route) {
            expect(adj.get(prev)).toContain(hop);
            prev = hop;
        }
    });
});

describe('adjacentSystems', () => {
    it('returns the neighbours of the current system', () => {
        expect(adjacentSystems(adj, 'b')).toEqual(['a', 'c', 'e']);
    });
});

describe('cycleSingle (Tab cycling)', () => {
    const neighbours = adjacentSystems(adj, 'b'); // ['a', 'c', 'e']
    it('starts from nothing and advances to the first neighbour', () => {
        expect(cycleSingle(neighbours, undefined)).toEqual('a');
    });
    it('advances through neighbours in order', () => {
        expect(cycleSingle(neighbours, 'a')).toEqual('c');
        expect(cycleSingle(neighbours, 'c')).toEqual('e');
    });
    it('wraps from the last neighbour straight to the first', () => {
        // reference_experiments M7: no "nothing selected" step.
        expect(cycleSingle(neighbours, 'e')).toEqual('a');
    });
    it('follows link-slot order, not id order', () => {
        // The kit hub's links [2144, 2142, 2145, 2141, 2143] cycled SW,
        // NE, WSW, South, East, then SW again.
        const slots = ['2144', '2142', '2145', '2141', '2143'];
        const seen: (string | undefined)[] = [];
        let pick: string | undefined;
        for (let i = 0; i < 6; i++) {
            pick = cycleSingle(slots, pick);
            seen.push(pick);
        }
        expect(seen).toEqual([...slots, '2144']);
    });
    it('starts over from the first neighbour after a non-neighbour pick', () => {
        expect(cycleSingle(neighbours, 'z')).toEqual('a');
    });
    it('cycles backward', () => {
        expect(cycleSingle(neighbours, undefined, -1)).toEqual('e');
        expect(cycleSingle(neighbours, 'a', -1)).toEqual('e');
        expect(cycleSingle(neighbours, 'e', -1)).toEqual('c');
    });
    it('returns undefined when there are no neighbours', () => {
        expect(cycleSingle([], 'a')).toBeUndefined();
    });
});

describe('effectiveRoute (multi-jump precedence)', () => {
    it('is empty when nothing is set', () => {
        expect(effectiveRoute(adj, 'a', { pinned: [] })).toEqual([]);
    });
    it('uses the single-jump route when no pins exist', () => {
        expect(effectiveRoute(adj, 'a', { pinned: [], single: 'b' }))
            .toEqual(['b']);
    });
    it('uses the expanded multi-jump route when pins exist', () => {
        expect(effectiveRoute(adj, 'a', { pinned: ['d'] }))
            .toEqual(['b', 'c', 'd']);
    });
    it('lets the multi-jump route take precedence over the single one',
        () => {
            expect(effectiveRoute(adj, 'a', { pinned: ['d'], single: 'b' }))
                .toEqual(['b', 'c', 'd']);
        });
    it('falls back to the single route when every pin is unroutable', () => {
        expect(effectiveRoute(adj, 'a', { pinned: ['z'], single: 'b' }))
            .toEqual(['b']);
    });
    it('ignores a single-jump route pointing at the current system', () => {
        expect(effectiveRoute(adj, 'a', { pinned: [], single: 'a' }))
            .toEqual([]);
    });
    it('ignores a single-jump route that is not adjacent', () => {
        expect(effectiveRoute(adj, 'a', { pinned: [], single: 'd' }))
            .toEqual([]);
    });
});

describe('reconcileRouteState', () => {
    it('drops leading pins the player has arrived at', () => {
        const state = reconcileRouteState(
            { pinned: ['d', 'f'] }, 'd', adj, []);
        expect(state.pinned).toEqual(['f']);
    });
    it('clears a single-jump destination that is no longer adjacent', () => {
        const state = reconcileRouteState(
            { pinned: [], single: 'a' }, 'd', adj, []);
        expect(state.single).toBeUndefined();
    });
    it('keeps a single-jump destination that is still adjacent', () => {
        const state = reconcileRouteState(
            { pinned: [], single: 'c' }, 'd', adj, []);
        expect(state.single).toEqual('c');
    });
    it('adopts a longer simulation route by pinning each hop', () => {
        const state = reconcileRouteState(
            { pinned: [] }, 'a', adj, ['b', 'c', 'd']);
        expect(state.pinned).toEqual(['b', 'c', 'd']);
        expect(expandRoute(adj, 'a', state.pinned))
            .toEqual(['b', 'c', 'd']);
    });
    it('adopts a one-hop simulation route as the single-jump route', () => {
        const state = reconcileRouteState({ pinned: [] }, 'a', adj, ['b']);
        expect(state.single).toEqual('b');
        expect(state.pinned).toEqual([]);
    });
    it('does not adopt the sim route when client state already exists',
        () => {
            const state = reconcileRouteState(
                { pinned: ['f'] }, 'a', adj, ['b', 'c', 'd']);
            expect(state.pinned).toEqual(['f']);
        });
});

/**
 * Nova stacks several copies of one system at the same map position and
 * swaps between them with control bits (the two Sols at (0,0), nova:130
 * under !(b147|b305) and nova:531 under (b147|b305)). The copies have
 * different ids but are the SAME PLACE to the player, so a route that ends
 * — or resumes — at a copy of the system the player is standing in would
 * fly them out and straight back in again.
 *
 * The galaxy here adds a2, a duplicate of a, linked from b exactly as both
 * Sols are linked from Tichel.
 */
describe('stacked duplicate systems (same place, different ids)', () => {
    const DUP_SYSTEMS = [
        { id: 'a', links: ['b'] },
        { id: 'a2', links: ['b'] },
        { id: 'b', links: ['a', 'a2', 'c', 'e'] },
        { id: 'c', links: ['b', 'd'] },
        { id: 'd', links: ['c'] },
        { id: 'e', links: ['b', 'f'] },
        { id: 'f', links: ['e'] },
    ];
    const dupAdj = buildAdjacency(DUP_SYSTEMS);
    const place = new Map([['a', 'A'], ['a2', 'A'], ['b', 'B'], ['c', 'C'],
    ['d', 'D'], ['e', 'E'], ['f', 'F']]);
    const samePlace = (x: string, y: string) =>
        x === y || place.get(x) === place.get(y);

    it('expandRoute skips a pin that is a duplicate of the anchor', () => {
        // Without this the route is ['b', 'a2']: out to b and back into
        // the system the player never left.
        expect(expandRoute(dupAdj, 'a', ['a2'], samePlace)).toEqual([]);
    });
    it('expandRoute still routes to a genuinely different system', () => {
        expect(expandRoute(dupAdj, 'a', ['a2', 'c'], samePlace))
            .toEqual(['b', 'c']);
    });
    it('effectiveRoute ignores a single-jump pick that is a duplicate of '
        + 'the current system', () => {
            expect(effectiveRoute(dupAdj, 'a', { pinned: [], single: 'a2' },
                samePlace)).toEqual([]);
        });
    it('reconcileRouteState drops leading pins the player has arrived at '
        + 'under a different copy of the same system', () => {
            const state = reconcileRouteState({ pinned: ['a2', 'c'] }, 'a',
                dupAdj, [], samePlace);
            expect(state.pinned).toEqual(['c']);
        });
    it('defaults to plain id equality when no place test is given', () => {
        expect(expandRoute(dupAdj, 'a', ['a2'])).toEqual(['b', 'a2']);
    });
});

describe('formatMapDate', () => {
    it('formats like the original map date readout', () => {
        expect(formatMapDate({ day: 18, month: 11, year: 1177 }))
            .toEqual('Nov. 18th, 1177 NC');
        expect(formatMapDate({ day: 17, month: 3, year: 1178 }))
            .toEqual('Mar. 17th, 1178 NC');
    });
    it('uses correct ordinals', () => {
        expect(formatMapDate({ day: 1, month: 1, year: 1177 }))
            .toEqual('Jan. 1st, 1177 NC');
        expect(formatMapDate({ day: 2, month: 1, year: 1177 }))
            .toEqual('Jan. 2nd, 1177 NC');
        expect(formatMapDate({ day: 3, month: 1, year: 1177 }))
            .toEqual('Jan. 3rd, 1177 NC');
        expect(formatMapDate({ day: 11, month: 1, year: 1177 }))
            .toEqual('Jan. 11th, 1177 NC');
        expect(formatMapDate({ day: 21, month: 1, year: 1177 }))
            .toEqual('Jan. 21st, 1177 NC');
    });
    it('does not abbreviate May', () => {
        expect(formatMapDate({ day: 5, month: 5, year: 1178 }))
            .toEqual('May 5th, 1178 NC');
    });
});

describe('hazardDescription', () => {
    it('is None for a clear system', () => {
        expect(hazardDescription(0)).toEqual('None');
    });
    it('tiers asteroid density', () => {
        expect(hazardDescription(2)).toEqual('Light asteroid field');
        expect(hazardDescription(8)).toEqual('Moderate asteroid field');
        expect(hazardDescription(16)).toEqual('Dense asteroid field');
    });
    it('mentions interference', () => {
        expect(hazardDescription(0, 50)).toEqual('Sensor interference');
        expect(hazardDescription(16, 50))
            .toEqual('Dense asteroid field, Sensor interference');
    });
});

// ---------------------------------------------------------------------------
// Known systems only (Matthew, 2026-11-23): the router may END a route in a
// system the player has not explored, but never fly THROUGH one.
//
//   a - b - c - d          explored: a, b, d    (c and the e-f arm are not)
//       |
//       e - f
// ---------------------------------------------------------------------------
describe('routing through explored systems only', () => {
    const explored = new Set(['a', 'b', 'd']);
    const passable = (id: string) => explored.has(id);
    const same = (x: string, y: string) => x === y;

    it('may end a path in an unexplored neighbour of explored space', () => {
        // Exactly where a plain single jump from b could go.
        expect(shortestPath(adj, 'a', 'c', passable)).toEqual(['b', 'c']);
        expect(shortestPath(adj, 'a', 'e', passable)).toEqual(['b', 'e']);
    });

    it('never passes through an unexplored system', () => {
        // f is only reachable through e, and d only through c.
        expect(shortestPath(adj, 'a', 'f', passable)).toBeNull();
        expect(shortestPath(adj, 'a', 'd', passable)).toBeNull();
    });

    it('does not reproduce the original\'s D-U-U-D pin-by-pin quirk', () => {
        // The original lets a pilot shift-click b, then e, then f (D-U-U)
        // and flies the chain. Here the route stops at the first unexplored
        // pin: f would have to be flown to FROM unexplored e.
        expect(expandRoute(adj, 'a', ['b', 'e', 'f'], same, passable))
            .toEqual(['b', 'e']);
        // Even when the pin after the unexplored one is explored (a-b-c-d:
        // D-D-U-D), nothing is plotted beyond the unexplored c.
        expect(expandRoute(adj, 'a', ['c', 'd'], same, passable))
            .toEqual(['b', 'c']);
    });

    it('refuses to pin what the explored route cannot reach', () => {
        expect(canPin(adj, 'a', [], 'c', same, passable)).toBeTrue();
        expect(canPin(adj, 'a', [], 'f', same, passable)).toBeFalse();
        // After a route that ends in unexplored e, nothing more can be
        // pinned — not even an explored system.
        expect(canPin(adj, 'a', ['e'], 'f', same, passable)).toBeFalse();
        expect(canPin(adj, 'a', ['e'], 'd', same, passable)).toBeFalse();
        // The ship's own system, and a re-pin of the route's end, add
        // nothing.
        expect(canPin(adj, 'a', [], 'a', same, passable)).toBeFalse();
        expect(canPin(adj, 'a', ['b'], 'b', same, passable)).toBeFalse();
        // From an explored pin, on to its unexplored neighbour, is fine.
        expect(canPin(adj, 'a', ['b'], 'e', same, passable)).toBeTrue();
    });

    it('always lets the route start from the current system', () => {
        // Standing in an unexplored system (a fresh record, a rollback)
        // must not strand the ship: the start is never checked.
        const onlyD = (id: string) => id === 'd';
        expect(shortestPath(adj, 'c', 'b', onlyD)).toEqual(['b']);
        expect(expandRoute(adj, 'c', ['b'], same, onlyD)).toEqual(['b']);
    });

    it('feeds the effective route the same rule', () => {
        expect(effectiveRoute(adj, 'a', { pinned: ['f'] }, same, passable))
            .toEqual([]);
        expect(effectiveRoute(adj, 'a', { pinned: ['f'], single: 'b' },
            same, passable)).toEqual(['b']);
    });

    it('plans over the whole graph when no record is given', () => {
        // The default (maps without a discovery record: the rollback
        // replay) is unchanged.
        expect(shortestPath(adj, 'a', 'f')).toEqual(['b', 'e', 'f']);
        expect(canPin(adj, 'a', [], 'f')).toBeTrue();
    });
});
