import 'jasmine';
import {
    ControlBitNamespaces, FIRST_PRIVATE_PHYSICAL_CONTROL_BIT,
} from 'novadatainterface/control_bit_namespaces';
import {
    ControlBitPair, ControlBitResolver, sortControlBitPairs,
} from './control_bit_namespaces.js';

const P0 = FIRST_PRIVATE_PHYSICAL_CONTROL_BIT;

/**
 * Stock base set {100, 101, 9999}; extra-outfits privately uses 9001 and
 * 9002; arpia privately uses 2050 and 9001 (a collision, separated).
 */
const NAMESPACES: ControlBitNamespaces = {
    baseSet: [100, 101, 9999],
    namespaces: [
        { namespace: 'extra-outfits', bits: [[9001, P0], [9002, P0 + 1]] },
        { namespace: 'arpia', bits: [[2050, P0 + 2], [9001, P0 + 3]] },
    ],
    pluginOrder: ['Nuke', 'extra-outfits', 'arpia'],
};

describe('sortControlBitPairs', () => {
    it('sorts by namespace then bit and drops duplicates', () => {
        const pairs: ControlBitPair[] = [
            ['nova', 5], ['arpia', 9], ['nova', 1], ['arpia', 9], ['Nuke', 3],
        ];
        expect(sortControlBitPairs(pairs)).toEqual([
            ['Nuke', 3], ['arpia', 9], ['nova', 1], ['nova', 5],
        ]);
    });
});

describe('ControlBitResolver', () => {
    const resolver = new ControlBitResolver(NAMESPACES);

    it('maps stock pairs to their own number from any namespace', () => {
        expect(resolver.physicalBit(['nova', 100])).toBe(100);
        expect(resolver.physicalBit(['nova', 4242])).toBe(4242);
        // A base-set bit referenced by a plug-in IS the stock bit.
        expect(resolver.physicalBit(['arpia', 101])).toBe(101);
    });

    it('maps private pairs through the current allocation', () => {
        expect(resolver.physicalBit(['extra-outfits', 9001])).toBe(P0);
        expect(resolver.physicalBit(['arpia', 9001])).toBe(P0 + 3);
        expect(resolver.physicalBit(['arpia', 2050])).toBe(P0 + 2);
    });

    it('has no physical bit for an unloaded namespace or unreferenced bit', () => {
        expect(resolver.physicalBit(['singularity', 1300])).toBeUndefined();
        expect(resolver.physicalBit(['arpia', 7777])).toBeUndefined();
        // A loaded plug-in with no private bits is still loaded...
        expect(resolver.hasNamespace('Nuke')).toBe(true);
        expect(resolver.hasNamespace('singularity')).toBe(false);
        // ...but a bit it never references still parks.
        expect(resolver.physicalBit(['Nuke', 5])).toBeUndefined();
    });

    it('turns live physical bits into canonical pairs', () => {
        expect(resolver.toPairs(new Set([P0 + 3, 100, P0, 7]))).toEqual([
            ['arpia', 9001], ['extra-outfits', 9001], ['nova', 7], ['nova', 100],
        ]);
        // A private-range number the mapping does not know keeps
        // round-tripping as itself rather than vanishing.
        expect(resolver.pair(P0 + 50)).toEqual(['physical', P0 + 50]);
        expect(resolver.physicalBit(['physical', P0 + 50])).toBe(P0 + 50);
    });

    it('resolves saved pairs and parks the rest', () => {
        const { physical, parked } = resolver.fromPairs([
            ['nova', 100], ['arpia', 2050], ['singularity', 1300],
            ['extra-outfits', 9002], ['arpia', 7777], ['nova', 9999],
        ]);
        expect([...physical].sort((a, b) => a - b))
            .toEqual([100, 9999, P0 + 1, P0 + 2]);
        expect(parked).toEqual([['arpia', 7777], ['singularity', 1300]]);
    });

    it('round-trips pairs -> physical -> pairs under the same plug-in set', () => {
        const pairs: ControlBitPair[] = sortControlBitPairs([
            ['nova', 100], ['nova', 42], ['arpia', 2050], ['arpia', 9001],
            ['extra-outfits', 9001],
        ]);
        const { physical, parked } = resolver.fromPairs(pairs);
        expect(parked).toEqual([]);
        expect(resolver.toPairs(physical)).toEqual(pairs);
    });

    describe('migrateLegacy (bare physical numbers from an old save)', () => {
        it('reads stock-range numbers nobody claims as stock bits', () => {
            const { physical, parked } = resolver.migrateLegacy([100, 42, 9999]);
            expect([...physical].sort((a, b) => a - b)).toEqual([42, 100, 9999]);
            expect(parked).toEqual([]);
        });

        it('gives a number every plug-in that uses it privately', () => {
            // 9001 was one shared bit; both plug-ins saw it set, so both
            // keep seeing it set. 2050 is arpia's alone.
            const { physical } = resolver.migrateLegacy([9001, 2050]);
            expect([...physical].sort((a, b) => a - b))
                .toEqual([P0, P0 + 2, P0 + 3]);
        });

        it('reads private-range numbers back through the mapping', () => {
            const { physical } = resolver.migrateLegacy([P0 + 2, 5]);
            expect([...physical].sort((a, b) => a - b)).toEqual([5, P0 + 2]);
        });
    });

    it('with no namespace data, keeps stock numbers and parks plug-in pairs', () => {
        const bare = new ControlBitResolver(undefined);
        expect(bare.pluginOrder).toEqual([]);
        expect(bare.physicalBit(['nova', 212])).toBe(212);
        expect(bare.physicalBit(['arpia', 2050])).toBeUndefined();
        const { physical, parked } = bare.fromPairs([['nova', 212], ['arpia', 2050]]);
        expect(physical).toEqual(new Set([212]));
        expect(parked).toEqual([['arpia', 2050]]);
        // Legacy numbers all read as stock.
        expect(bare.migrateLegacy([1, 9001]).physical).toEqual(new Set([1, 9001]));
    });
});
