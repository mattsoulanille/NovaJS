import { BinSetCollection } from './bin_set';
import { subset } from './utils';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

describe('BinSetCollection', () => {
    let alphabet: Set<string>;
    let partOfAlphabet: Set<string>;
    let notSubset: Set<string>;
    let binSetCollection: BinSetCollection<string>;
    beforeEach(() => {
        alphabet = new Set([...ALPHABET]);
        partOfAlphabet = new Set([..."abcdefwxyz"]);
        notSubset = new Set([..."abcde", "not"]);
        binSetCollection = new BinSetCollection();
    });

    it('returns true if it is a subset', () => {
        const aSet = binSetCollection.of(alphabet);
        const sub = binSetCollection.of(partOfAlphabet);
        expect(binSetCollection.subset(sub, aSet)).toBeTrue();
    });

    it('returns false if it is not a subset', () => {
        const aSet = binSetCollection.of(alphabet);
        const notSub = binSetCollection.of(notSubset);
        expect(binSetCollection.subset(notSub, aSet)).toBeFalse();
    });

    it('works with large sets', () => {
        const largeSet = new Set<number>();
        for (let i = 0; i < 10_000; i++) {
            largeSet.add(Math.random());
        }

        const largeSubset = new Set<number>();
        const largeSetArray = [...largeSet];
        for (let i = 0; i < largeSet.size / 10; i++) {
            const randomIndex = Math.floor(Math.random() * largeSet.size);
            largeSubset.add(largeSetArray[randomIndex]);
        }

        const numSetCollection = new BinSetCollection<number>();
        const largeSetBin = numSetCollection.of(largeSet);
        const largeSubsetBin = numSetCollection.of(largeSubset);

        const notSubset = new Set([...largeSubset, 2]);
        const notSubsetBin = numSetCollection.of(notSubset);

        expect(numSetCollection.subset(largeSubsetBin, largeSetBin)).toBeTrue();
        expect(numSetCollection.subset(notSubsetBin, largeSetBin)).toBeFalse();
    });

    it('does not compare across different BinSetCollections', () => {
        const c1 = new BinSetCollection<number>();
        const c2 = new BinSetCollection<number>();

        const s1 = c1.of(new Set([1, 2, 3]));
        const s2 = c2.of(new Set([1, 2, 3]));
        expect(() => {
            c1.subset(s1, s2);
        }).toThrowError(/Cannot compare/);
    });

    it('works after adding a lot of values', () => {
        const collection = new BinSetCollection<number>();
        const smallSet = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
            11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
            21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);

        const smallSetBin = collection.of(smallSet);
        expect(smallSetBin.bits.length).toBe(1); // Only 1 number needed.

        const largeSet = new Set([...smallSet, 33, 34, 35]);
        const largeSetBin = collection.of(largeSet);
        expect(largeSetBin.bits.length).toBe(2); // Now 2 are needed. Comparison should still work.

        expect(collection.subset(largeSetBin, smallSetBin)).toBeFalse();
        expect(collection.subset(smallSetBin, largeSetBin)).toBeTrue();
    });

    it('converts back to a set', () => {
        const aSet = binSetCollection.of(alphabet);
        const sub = binSetCollection.of(partOfAlphabet);

        expect(aSet.toSet()).toEqual(alphabet);
        expect(sub.toSet()).toEqual(partOfAlphabet);
    });

    it('deletes items from a set', () => {
        const aSet = binSetCollection.of(new Set(['cat', 'dog', 'cow']));
        expect(aSet.toSet()).toEqual(new Set(['cat', 'dog', 'cow']));

        aSet.delete('dog');
        expect(aSet.toSet()).toEqual(new Set(['cat', 'cow']));

        aSet.delete('asdf');
        expect(aSet.toSet()).toEqual(new Set(['cat', 'cow']));
    });

    xit('hacky perf', () => {
        const largeSet = new Set<number>();
        for (let i = 0; i < 200; i++) {
            largeSet.add(Math.random());
        }

        const largeSubset = new Set<number>();
        const largeSetArray = [...largeSet];
        for (let i = 0; i < largeSet.size / 10; i++) {
            const randomIndex = Math.floor(Math.random() * largeSet.size);
            largeSubset.add(largeSetArray[randomIndex]);
        }

        const numSetCollection = new BinSetCollection<number>();
        const largeSetBin = numSetCollection.of(largeSet);
        const largeSubsetBin = numSetCollection.of(largeSubset);

        const trials = 1_000_000;
        let before = performance.now();
        for (let i = 0; i < trials; i++) {
            numSetCollection.subset(largeSubsetBin, largeSetBin);
        }
        let after = performance.now();
        console.log(`${after - before} ms for ${trials} trials for binset`);

        before = performance.now();
        for (let i = 0; i < trials; i++) {
            subset(largeSubset, largeSet);
        }
        after = performance.now();
        console.log(`${after - before} ms for ${trials} trials for native set`);
    });
});
