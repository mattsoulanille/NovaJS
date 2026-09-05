import { isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import 'jasmine';
import { set } from './set.js';


describe('Set', () => {
    it('decodes arrays as sets', () => {
        const testArray = [1, 2, 3, 2, 4, 5];

        const decoded = set(t.number).decode(testArray);
        if (isLeft(decoded)) {
            fail(`Expected to decode [${testArray}] successfully`);
            return;
        }

        expect(decoded.right).toEqual(new Set([1, 2, 3, 4, 5]));
    });

    it('encodes sets as arrays', () => {
        const testSet = new Set(['foo', 'bar', 'baz']);

        const encoded = set(t.string).encode(testSet);
        expect(encoded).toEqual(['foo', 'bar', 'baz'])
    });

    it('works on complex types', () => {
        const testArray = [1, 'cat', { x: 'dog' }, 2, { y: 123 }];
        const xStringType = t.type({ x: t.string });
        const yNumberType = t.type({ y: t.number });
        const setValueType = t.union([xStringType, yNumberType, t.number, t.string]);

        const decoded = set(setValueType).decode(testArray);
        if (isLeft(decoded)) {
            fail(`Expected to decode [${testArray}] successfully`);
            return;
        }

        expect(decoded.right).toEqual(new Set(testArray));
    });

    it('calls the subtypes\' encode methods', () => {
        const setOfSets = set(set(t.number));

        const input: t.TypeOf<typeof setOfSets> = new Set([
            new Set([1, 2, 3]),
            new Set([4, 5, 6]),
        ]);

        const encoded = setOfSets.encode(input);
        expect(encoded).toEqual([[1, 2, 3], [4, 5, 6]]);

        const decoded = setOfSets.decode(encoded);
        if (isLeft(decoded)) {
            fail(`Expected to decode [${encoded}] successfully`);
            return;
        }

        expect(decoded.right).toEqual(input);
    });

    it('returns left if a decode fails', () => {
        const notASet = { x: 123 };
        const result = set(t.number).decode(notASet);
        expect(isLeft(result)).toBeTrue();
    });

    // #84: the guard used reduce without an initial value, which throws
    // on an empty array — so an empty Set (and anything that routes
    // through `is`, like a union encode) crashed instead of matching.
    it('is-guard accepts an empty set', () => {
        expect(set(t.string).is(new Set())).toBeTrue();
        expect(set(t.string).is(new Set(['a']))).toBeTrue();
        expect(set(t.string).is(new Set([1]))).toBeFalse();
        expect(set(t.string).is(['a'])).toBeFalse();
    });

    it('encodes an empty set inside a union', () => {
        // communicator_message's `destination: t.union([t.string, set(t.string)])`
        const codec = t.union([t.string, set(t.string)]);
        expect(codec.encode(new Set())).toEqual([]);
    });
});
