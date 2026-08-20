import 'jasmine';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DISCOVERY_UNKNOWN, DiscoveryLevel,
    drawnSystems, knownSystemProperties, linkKnown, MapOutfitSystem,
    mapOutfitSystems, SystemAdjacency, toDiscoveryLevel,
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
