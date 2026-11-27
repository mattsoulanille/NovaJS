import 'jasmine';
import {
    adjacentSystems,
    buildAdjacency,
    canPin,
    cycleSingle,
    dropPassedPins,
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
    it('drops the pins a multi-jump passed through', () => {
        // a -> b -> c -> d pinned hop by hop, flown a -> c via b in one
        // jump: b was never arrived at, but it is behind the player.
        const state = reconcileRouteState({ pinned: ['b', 'c', 'd'] }, 'c',
            adj, ['d'], undefined, { from: 'a', hops: ['b', 'c'] });
        expect(state.pinned).toEqual(['d']);
        expect(expandRoute(adj, 'c', state.pinned)).toEqual(['d']);
    });
});

describe('dropPassedPins', () => {
    const arrival = { from: 'a', hops: ['b', 'c'] };

    it('drops every pin the hops reach, in order', () => {
        expect(dropPassedPins(['b', 'c', 'd'], arrival)).toEqual(['d']);
        expect(dropPassedPins(['c', 'd'], arrival)).toEqual(['d']);
    });
    it('keeps a later visit to a passed system', () => {
        // a -> b -> c -> b -> e: the jump to c leaves b -> e.
        expect(dropPassedPins(['b', 'c', 'b', 'e'], arrival))
            .toEqual(['b', 'e']);
    });
    it('stops at the first pin the hops do not reach', () => {
        expect(dropPassedPins(['d', 'b'], arrival)).toEqual(['d', 'b']);
        expect(dropPassedPins(['b', 'e', 'c'], arrival)).toEqual(['e', 'c']);
    });
    it('keeps a pin the hops only passed on the way to an earlier one',
        () => {
            // Pinned c then b: the route is a -> b -> c -> b, and the jump
            // to c (via b) has reached c but not the pinned return to b.
            expect(dropPassedPins(['c', 'b'], arrival)).toEqual(['b']);
        });
    it('drops pins the route skipped as the same place as the anchor', () => {
        expect(dropPassedPins(['a', 'b', 'b', 'd'], arrival)).toEqual(['d']);
    });
    it('matches by place', () => {
        const samePlace = (x: string, y: string) =>
            x.replace('2', '') === y.replace('2', '');
        expect(dropPassedPins(['b2', 'c', 'd'], arrival, samePlace))
            .toEqual(['d']);
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
    it("uses the original's abbreviations (STR# 137 entries 13-24)", () => {
        const months = Array.from({ length: 12 }, (_, i) =>
            formatMapDate({ day: 4, month: i + 1, year: 1177 })
                .split(' ')[0]);
        expect(months).toEqual(['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May',
            'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']);
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
// Drawn systems only (Matthew, 2026-11-23): the router flies through every
// system the map DRAWS, explored or not — "D-U-D is allowed. Surprisingly,
// also D-U-U-D is allowed" (the original, reference_experiments M4) — and
// never through one the map does not draw.
//
//        p - q - r            explored (D): h, p, q, r, g, k, t
//      /  \      \            drawn but unexplored (U): u1, u2, v, m, s1, s3
//     h -- u1 - u2 - g        not drawn (X): s2 — two jumps from anything
//      \    \                 explored, so the map leaves it out
//       \    v (also linked to p)
//        m - k - s1 - s2 - s3 - t
//
// h's links are [p, u1, m], in that slot order.
// ---------------------------------------------------------------------------
describe('routing through every drawn system', () => {
    const drawnAdj = buildAdjacency([
        { id: 'h', links: ['p', 'u1', 'm'] },
        { id: 'p', links: ['h', 'q', 'v'] },
        { id: 'q', links: ['p', 'r'] },
        { id: 'r', links: ['q', 'g'] },
        { id: 'g', links: ['r', 'u2'] },
        { id: 'u1', links: ['h', 'u2', 'v'] },
        { id: 'u2', links: ['u1', 'g'] },
        { id: 'v', links: ['p', 'u1'] },
        { id: 'm', links: ['h', 'k'] },
        { id: 'k', links: ['m', 's1'] },
        { id: 's1', links: ['k', 's2'] },
        { id: 's2', links: ['s1', 's3'] },
        { id: 's3', links: ['s2', 't'] },
        { id: 't', links: ['s3'] },
    ]);
    const drawn = new Set(['h', 'p', 'q', 'r', 'g', 'k', 't',
        'u1', 'u2', 'v', 'm', 's1', 's3']);
    const passable = (id: string) => drawn.has(id);
    const same = (x: string, y: string) => x === y;

    it('takes the short way through two unexplored systems (D-U-U-D) '
        + 'in a single shift-click', () => {
            // Matthew's screenshot: the route went the long way round
            // explored space instead of through two dim systems.
            expect(shortestPath(drawnAdj, 'h', 'g', passable))
                .toEqual(['u1', 'u2', 'g']);
            expect(canPin(drawnAdj, 'h', [], 'g', same, passable))
                .toBeTrue();
            expect(expandRoute(drawnAdj, 'h', ['g'], same, passable))
                .toEqual(['u1', 'u2', 'g']);
        });

    it('routes D-U-D in a single shift-click', () => {
        expect(canPin(drawnAdj, 'h', [], 'k', same, passable)).toBeTrue();
        expect(expandRoute(drawnAdj, 'h', ['k'], same, passable))
            .toEqual(['m', 'k']);
    });

    it('routes D-U-U-D pin by pin, as the original did', () => {
        // The original's Hub -> East -> Void -> Far, one pin at a time.
        expect(canPin(drawnAdj, 'h', [], 'u1', same, passable)).toBeTrue();
        expect(canPin(drawnAdj, 'h', ['u1'], 'u2', same, passable))
            .toBeTrue();
        expect(canPin(drawnAdj, 'h', ['u1', 'u2'], 'g', same, passable))
            .toBeTrue();
        expect(expandRoute(drawnAdj, 'h', ['u1', 'u2', 'g'], same,
            passable)).toEqual(['u1', 'u2', 'g']);
        // And D-U-D the same way.
        expect(expandRoute(drawnAdj, 'h', ['m', 'k'], same, passable))
            .toEqual(['m', 'k']);
    });

    it('keeps on past an unexplored pin', () => {
        // A route that ends in unexplored u1 is extended from there, into
        // explored space or on into more unexplored space.
        expect(canPin(drawnAdj, 'h', ['u1'], 'g', same, passable))
            .toBeTrue();
        expect(expandRoute(drawnAdj, 'h', ['u1', 'g'], same, passable))
            .toEqual(['u1', 'u2', 'g']);
        expect(expandRoute(drawnAdj, 'h', ['v', 'g'], same, passable))
            .toEqual(['p', 'v', 'u1', 'u2', 'g']);
    });

    describe('with auto-routing off (the original; NovaJS Enhancements)',
        () => {
            it('ignores a shift-click it would have to plot a path to', () => {
                // D-U-U-D in one click: the original ignores it (wave 10).
                expect(canPin(drawnAdj, 'h', [], 'g', same, passable, false))
                    .toBeFalse();
                expect(canPin(drawnAdj, 'h', [], 'k', same, passable, false))
                    .toBeFalse();
                // Explored intermediates are no different (wave 11: one
                // shift-click two hops out over explored systems is
                // ignored): q is two jumps, through the drawn p.
                expect(canPin(drawnAdj, 'h', [], 'q', same, passable, false))
                    .toBeFalse();
            });

            it('takes a pin one jump past the route\'s end, unexplored or '
                + 'not', () => {
                expect(canPin(drawnAdj, 'h', [], 'u1', same, passable, false))
                    .toBeTrue();
                expect(canPin(drawnAdj, 'h', ['u1'], 'u2', same, passable,
                    false)).toBeTrue();
                expect(canPin(drawnAdj, 'h', ['u1', 'u2'], 'g', same,
                    passable, false)).toBeTrue();
                // ...measured from the END, not from where the ship is.
                expect(canPin(drawnAdj, 'h', ['u1'], 'p', same, passable,
                    false)).toBeFalse();
            });

            it('still never pins through an undrawn system', () => {
                expect(canPin(drawnAdj, 'h', ['m', 'k', 's1'], 's3', same,
                    passable, false)).toBeFalse();
            });

            it('defaults to auto-routing ON', () => {
                expect(canPin(drawnAdj, 'h', [], 'g', same, passable))
                    .toBe(canPin(drawnAdj, 'h', [], 'g', same, passable,
                        true));
            });
        });

    it('never routes through a system the map does not draw', () => {
        // t is only reachable through the undrawn s2 (D-U-X-U-D).
        expect(shortestPath(drawnAdj, 'h', 't', passable)).toBeNull();
        expect(shortestPath(drawnAdj, 'k', 's3', passable)).toBeNull();
        expect(canPin(drawnAdj, 'h', [], 't', same, passable)).toBeFalse();
        expect(canPin(drawnAdj, 'h', [], 's3', same, passable)).toBeFalse();
        // Pin by pin is no way round it: s1 is fine, s3 beyond the
        // undrawn s2 is not.
        expect(canPin(drawnAdj, 'h', [], 's1', same, passable)).toBeTrue();
        expect(canPin(drawnAdj, 'h', ['s1'], 's3', same, passable))
            .toBeFalse();
        expect(expandRoute(drawnAdj, 'h', ['s1', 's3', 't'], same,
            passable)).toEqual(['m', 'k', 's1']);
        expect(effectiveRoute(drawnAdj, 'h', { pinned: ['t'] }, same,
            passable)).toEqual([]);
        expect(effectiveRoute(drawnAdj, 'h', { pinned: ['t'], single: 'm' },
            same, passable)).toEqual(['m']);
    });

    it('stops at an undrawn pin: nothing is plotted beyond it', () => {
        // The map never offers s2 as a pin; the pure rule still keeps any
        // route from flying on out of it.
        expect(expandRoute(drawnAdj, 'h', ['s2', 't'], same, passable))
            .toEqual(['m', 'k', 's1', 's2']);
        expect(canPin(drawnAdj, 'h', ['s2'], 't', same, passable))
            .toBeFalse();
    });

    it('breaks ties between equally short paths by link-slot order, '
        + 'explored or not', () => {
            // h -> p -> v and h -> u1 -> v are both two jumps; p comes
            // first among h's links, so the first is taken. The tie-break
            // is breadth-first search order, unchanged by this rule.
            expect(shortestPath(drawnAdj, 'h', 'v', passable))
                .toEqual(['p', 'v']);
            const u1First = buildAdjacency([
                ...[...drawnAdj].map(([id, links]) => ({
                    id, links: id === 'h' ? ['u1', 'p', 'm'] : links,
                })),
            ]);
            expect(shortestPath(u1First, 'h', 'v', passable))
                .toEqual(['u1', 'v']);
        });

    it('always lets the route start from the current system', () => {
        // Standing somewhere the predicate rejects (a fresh record, a
        // rollback) must not strand the ship: the start is never checked.
        const onlyK = (id: string) => id === 'k';
        expect(shortestPath(drawnAdj, 's2', 's1', onlyK)).toEqual(['s1']);
        expect(expandRoute(drawnAdj, 's2', ['s1'], same, onlyK))
            .toEqual(['s1']);
    });

    it('plans over the whole graph when no record is given', () => {
        // The default (maps without a discovery record: the rollback
        // replay) is unchanged.
        expect(shortestPath(adj, 'a', 'f')).toEqual(['b', 'e', 'f']);
        expect(canPin(adj, 'a', [], 'f')).toBeTrue();
    });
});
