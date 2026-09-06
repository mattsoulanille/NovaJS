import 'jasmine';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DISCOVERY_UNKNOWN, DiscoveryAccess,
    DiscoveryLevel, discoveryNCBOperators, drawnSystems, knownSystemProperties,
    linkKnown, MapOutfitSystem, mapOutfitSystems, resetDiscoveryNCBWarnings,
    SystemAdjacency, toDiscoveryLevel,
} from './discovery.js';

/**
 * A tiny galaxy, laid out as a line with one dead-end branch:
 *
 *     a — b — c — d
 *         |
 *         e
 *
 * plus `far`, linked to nothing the player can reach from a.
 */
const ADJ: SystemAdjacency = new Map<string, string[]>([
    ['a', ['b']],
    ['b', ['a', 'c', 'e']],
    ['c', ['b', 'd']],
    ['d', ['c']],
    ['e', ['b']],
    ['far', []],
]);

describe('toDiscoveryLevel', () => {
    it('reads the original pilot file\'s three states', () => {
        // "<= 0 unexplored, 1 visited, 2 visited and landed within".
        expect(toDiscoveryLevel(-1)).toBe(DISCOVERY_UNKNOWN);
        expect(toDiscoveryLevel(0)).toBe(DISCOVERY_UNKNOWN);
        expect(toDiscoveryLevel(1)).toBe(DISCOVERY_ENTERED);
        expect(toDiscoveryLevel(2)).toBe(DISCOVERY_LANDED);
    });

    it('clamps anything higher to "landed", and rejects non-numbers', () => {
        expect(toDiscoveryLevel(7)).toBe(DISCOVERY_LANDED);
        expect(toDiscoveryLevel('2')).toBe(DISCOVERY_UNKNOWN);
        expect(toDiscoveryLevel(undefined)).toBe(DISCOVERY_UNKNOWN);
        expect(toDiscoveryLevel(NaN)).toBe(DISCOVERY_UNKNOWN);
    });
});

describe('drawnSystems', () => {
    it('draws what the player knows plus a one-jump ring', () => {
        // Standing in b having only ever been to b: b is drawn labeled,
        // and a/c/e appear as the dim unlabeled ring. d is two jumps out
        // and is not on the map at all.
        const drawn = drawnSystems(['b'], ADJ, [], 'b');
        expect([...drawn].sort()).toEqual(['a', 'b', 'c', 'e']);
        expect(drawn.has('d')).toBeFalse();
    });

    it('does not extend the ring outward from ring systems', () => {
        // The ring is exactly one jump: c being drawn must not pull d in.
        const drawn = drawnSystems(['a'], ADJ, [], 'a');
        expect([...drawn].sort()).toEqual(['a', 'b']);
    });

    it('grows as more systems are discovered', () => {
        const drawn = drawnSystems(['a', 'c'], ADJ, [], 'a');
        expect([...drawn].sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('always draws the system the player is standing in', () => {
        // Even with nothing discovered — the map must stay usable.
        expect([...drawnSystems([], ADJ, [], 'd')]).toEqual(['d']);
    });

    it('draws an active mission\'s system however far away it is', () => {
        // The reference capture's lone dot with the orange arrow:
        // map_zoomed_out_showing_far_away_mission.png.
        const drawn = drawnSystems(['a'], ADJ, ['far'], 'a');
        expect(drawn.has('far')).toBeTrue();
    });

    it('drops the mission dot again once the mission is gone', () => {
        // Abort/complete the mission and nothing marks `far` any more;
        // it is still undiscovered and adjacent to nothing known, so the
        // dot disappears.
        expect(drawnSystems(['a'], ADJ, [], 'a').has('far')).toBeFalse();
    });

    it('changes nothing about a marked system already discovered', () => {
        const withMark = drawnSystems(['a', 'b'], ADJ, ['b'], 'a');
        const without = drawnSystems(['a', 'b'], ADJ, [], 'a');
        expect([...withMark].sort()).toEqual([...without].sort());
    });
});

describe('linkKnown', () => {
    const levels = new Map<string, DiscoveryLevel>([
        ['a', DISCOVERY_ENTERED], ['c', DISCOVERY_LANDED],
    ]);
    const levelOf = (id: string) => levels.get(id) ?? DISCOVERY_UNKNOWN;

    it('draws a lane out of a system the player has been to', () => {
        expect(linkKnown('a', 'b', levelOf)).toBeTrue();
        expect(linkKnown('b', 'a', levelOf)).toBeTrue();
    });

    it('draws a lane between two visited systems', () => {
        expect(linkKnown('a', 'c', levelOf)).toBeTrue();
    });

    it('leaves a faraway mission dot connected to nothing', () => {
        // Neither end visited: `far`'s links are not the player's to know,
        // which is why the reference draws that dot bare.
        expect(linkKnown('far', 'd', levelOf)).toBeFalse();
    });
});

describe('knownSystemProperties', () => {
    it('tells you nothing about an undiscovered system', () => {
        expect(knownSystemProperties(DISCOVERY_UNKNOWN))
            .toEqual({ identity: false, commerce: false });
    });

    it('withholds goods and services until the player has LANDED', () => {
        expect(knownSystemProperties(DISCOVERY_ENTERED))
            .toEqual({ identity: true, commerce: false });
        expect(knownSystemProperties(DISCOVERY_LANDED))
            .toEqual({ identity: true, commerce: true });
    });
});

describe('mapOutfitSystems (oütf ModType 16)', () => {
    const systems: MapOutfitSystem[] = [
        { id: 'a', govt: 'nova:128', inhabited: true },
        { id: 'b', govt: 'nova:128', inhabited: false },
        { id: 'c', govt: null, inhabited: true },
        { id: 'd', govt: null, inhabited: false },
        { id: 'e', govt: 'nova:129', inhabited: true },
        { id: 'far', govt: null, inhabited: true },
    ];
    const classesOf = (govtId: string) =>
        govtId === 'nova:128' ? [0, 5] : [1];

    it('ModVal 1 reveals the present system and its neighbours', () => {
        // "1 and up: How many jumps away from present system to explore".
        expect(mapOutfitSystems(1, 'b', systems, ADJ, classesOf).sort())
            .toEqual(['a', 'b', 'c', 'e']);
    });

    it('ModVal 2 (the Vell-os Area Map) reaches two jumps out', () => {
        expect(mapOutfitSystems(2, 'a', systems, ADJ, classesOf).sort())
            .toEqual(['a', 'b', 'c', 'e']);
    });

    it('ModVal 3 reaches three jumps out', () => {
        expect(mapOutfitSystems(3, 'a', systems, ADJ, classesOf).sort())
            .toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('never reaches a system with no path to the present one', () => {
        expect(mapOutfitSystems(10, 'a', systems, ADJ, classesOf))
            .not.toContain('far');
    });

    it('ModVal 0 reveals only the present system', () => {
        expect(mapOutfitSystems(0, 'c', systems, ADJ, classesOf)).toEqual(['c']);
    });

    it('ModVal -1 reveals every inhabited INDEPENDENT system', () => {
        // Bible: "-1  Explore all inhabited independent systems". Not d
        // (independent but uninhabited), not a or e (governed).
        expect(mapOutfitSystems(-1, 'a', systems, ADJ, classesOf).sort())
            .toEqual(['c', 'far']);
    });

    it('ModVal -1000 and down reveal a whole govt class', () => {
        // "-1000 is govt class 0, -1001 is govt class 1, etc."
        expect(mapOutfitSystems(-1000, 'a', systems, ADJ, classesOf).sort())
            .toEqual(['a', 'b']);
        expect(mapOutfitSystems(-1001, 'a', systems, ADJ, classesOf))
            .toEqual(['e']);
        // Class 5 is nova:128's second class number: -1005.
        expect(mapOutfitSystems(-1005, 'a', systems, ADJ, classesOf).sort())
            .toEqual(['a', 'b']);
        expect(mapOutfitSystems(-1002, 'a', systems, ADJ, classesOf))
            .toEqual([]);
    });
});

/**
 * The two NCB operators the EVN Bible gives plug-in authors over this
 * record: `Exxx` "Returns 1 if the player has explored system ID xxx, 0 if
 * not" (:157) and `Xxxx` "make system ID xxx be explored" (:263).
 */
describe('the Exxx / Xxxx NCB operators', () => {
    /** A record backed by a plain map, and the map, so tests can inspect it. */
    function record(initial: [string, DiscoveryLevel][] = []) {
        const levels = new Map<string, DiscoveryLevel>(initial);
        const access: DiscoveryAccess = {
            level: id => levels.get(id) ?? DISCOVERY_UNKNOWN,
            // Raises only, exactly as discovery_store's markDiscovered does.
            markVisited: id => {
                if ((levels.get(id) ?? DISCOVERY_UNKNOWN) < DISCOVERY_ENTERED) {
                    levels.set(id, DISCOVERY_ENTERED);
                }
            },
        };
        return { levels, access };
    }

    /** Every number resolves to "nova:<n>"; nothing is unknown. */
    const stock = (id: number) => `nova:${id}`;

    beforeEach(() => resetDiscoveryNCBWarnings());

    it('Exxx is true at "visited" and at "visited and landed within"', () => {
        // "Explored" is the pilot file's level >= 1: FLYING IN explores a
        // system, and landing (level 2) obviously does not un-explore it.
        const { access } = record([
            ['nova:128', DISCOVERY_ENTERED],
            ['nova:129', DISCOVERY_LANDED],
        ]);
        const ops = discoveryNCBOperators(access, stock);
        expect(ops.hasExplored(128)).toBeTrue();
        expect(ops.hasExplored(129)).toBeTrue();
    });

    it('Exxx is false for a system the pilot has never entered', () => {
        const { access } = record();
        expect(discoveryNCBOperators(access, stock).hasExplored(130))
            .toBeFalse();
    });

    it('Xxxx raises an unknown system to "visited", not to "landed"', () => {
        // The Bible's wording is "make system ID xxx be explored"; the
        // stock uses are the tutorial revealing its next destination on the
        // map (mïsn 630's OnAccept is exactly "X128"), which is what flying
        // there would have taught you — not what landing there would.
        const { levels, access } = record();
        discoveryNCBOperators(access, stock).exploreSystem(128);
        expect(levels.get('nova:128')).toBe(DISCOVERY_ENTERED);
    });

    it('Xxxx never knocks a landed-in system back down', () => {
        // The store only ever raises (discovery_store's markDiscovered), so
        // a mission handing you a map you have already used keeps what the
        // landing taught you.
        const { levels, access } = record([['nova:130', DISCOVERY_LANDED]]);
        discoveryNCBOperators(access, stock).exploreSystem(130);
        expect(levels.get('nova:130')).toBe(DISCOVERY_LANDED);
    });

    it('resolves the bare number stock-first, then the writing plug-in',
        () => {
            // Same id-space rule every other numbered reference follows: a
            // plug-in's E130 means the STOCK system 130 when stock has one,
            // and its own 130 only when stock does not.
            const seen: string[] = [];
            const access: DiscoveryAccess = {
                level: id => {
                    seen.push(id);
                    return DISCOVERY_UNKNOWN;
                },
                markVisited: id => { seen.push(id); },
            };
            const resolve = (id: number) =>
                id === 130 ? 'nova:130' : 'arpia:400';
            const ops = discoveryNCBOperators(access, resolve);
            ops.hasExplored(130);
            ops.exploreSystem(400);
            expect(seen).toEqual(['nova:130', 'arpia:400']);
        });

    it('ignores a sÿst id no loaded data set defines, with one warning',
        () => {
            // A phantom id would sit in the pilot's PERSISTED record
            // forever, so X9999 writes nothing and E9999 reads false.
            const warn = spyOn(console, 'warn');
            const { levels, access } = record();
            const ops = discoveryNCBOperators(access, () => undefined);
            expect(ops.hasExplored(9999)).toBeFalse();
            ops.exploreSystem(9999);
            ops.exploreSystem(9999);
            expect(levels.size).toBe(0);
            // Once per spelling: E9999 and X9999. A looping crön must not
            // fill the console with the same complaint every day.
            expect(warn.calls.count()).toBe(2);
        });
});
