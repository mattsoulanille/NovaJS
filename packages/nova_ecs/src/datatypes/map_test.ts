import { isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import 'jasmine';
import { map } from './map.js';


describe('Map', () => {
    it('decodes arrays into maps', () => {
        const testArray: Array<[string, number]> = [
            ['cat', 123],
            ['dog', 456],
            ['horse', 789],
        ];

        const decoded = map(t.string, t.number).decode(testArray);
        if (isLeft(decoded)) {
            fail(`Expected to decode [${testArray}] successfully`);
            return;
        }

        expect(decoded.right).toEqual(new Map(testArray));
    });

    it('encodes maps as arrays', () => {
        const testArray: Array<[number, string]> = [
            [123, 'cat'],
            [456, 'dog'],
            [789, 'horse'],
        ];
        const testMap = new Map(testArray);

        const encoded = map(t.number, t.string).encode(testMap);
        expect(encoded).toEqual(testArray);
    });

    it('works on complex types', () => {
        const xStringType = t.type({ x: t.string });
        const yNumberType = t.type({ y: t.number });
        const testArray: Array<[t.TypeOf<typeof xStringType>,
            t.TypeOf<typeof yNumberType>]> = [
                [{ x: 'cat' }, { y: 123 }],
                [{ x: 'dog' }, { y: 456 }],
                [{ x: 'horse' }, { y: 789 }],
            ];

        const decoded = map(xStringType, yNumberType).decode(testArray);
        if (isLeft(decoded)) {
            fail(`Expected to decode [${testArray}] successfully`);
            return;
        }

        expect(decoded.right).toEqual(new Map(testArray));
    });

    it('calls the subtypes\' encode methods', () => {
        const mapOfMaps = map(map(t.string, t.number), map(t.number, t.string));

        const input: t.TypeOf<typeof mapOfMaps> = new Map([
            [new Map([['one', 1], ['two', 2]]), new Map([[1, 'one'], [2, 'two']])]
        ]);

        const encoded = mapOfMaps.encode(input);
        expect(encoded).toEqual([
            [[['one', 1], ['two', 2]], [[1, 'one'], [2, 'two']]]
        ]);

        const decoded = mapOfMaps.decode(encoded);
        if (isLeft(decoded)) {
            fail(`Expected to decode [${encoded}] successfully`);
            return;
        }
    });

    it('returns left if a decode fails', () => {
        const notAMap = [1, 2, 3, 4, 5];
        const result = map(t.number, t.string).decode(notAMap);
        expect(isLeft(result)).toBeTrue();
    });

    // #188: a Map's insertion order is simulation state (the weapons map
    // is fired in it — an exclusive weapon locks out those iterated
    // after it; missions run in acceptance order), so the encoded form
    // must carry it. A plain-object form could not: JS objects list
    // integer-like keys first, ascending, whatever order they were set
    // in (and one built by assignment turns a __proto__ key into its
    // prototype).
    describe('preserves insertion order and key types through a round trip', () => {
        function roundTrip<K, KE, V, VE>(codec: t.Type<Map<K, V>, [KE, VE][], unknown>,
            value: Map<K, V>): Map<K, V> {
            const decoded = codec.decode(JSON.parse(JSON.stringify(codec.encode(value))));
            if (isLeft(decoded)) {
                throw new Error('decode failed');
            }
            return decoded.right;
        }

        it('for string keys, including integer-like ones and __proto__', () => {
            const keys = ['nova:200', '10', '2', '__proto__', 'b', 'a'];
            const value = new Map(keys.map((key, i) => [key, i]));
            const back = roundTrip(map(t.string, t.number), value);
            expect([...back.keys()]).toEqual(keys);
            expect([...back.values()]).toEqual([0, 1, 2, 3, 4, 5]);
        });

        it('for number keys, which stay numbers', () => {
            const value = new Map([[10, 'ten'], [2, 'two'], [-1.5, 'neg'], [0, 'zero']]);
            const back = roundTrip(map(t.number, t.string), value);
            expect([...back.entries()]).toEqual([...value.entries()]);
            for (const key of back.keys()) {
                expect(typeof key).toBe('number');
            }
        });

        it('for -0 and NaN values', () => {
            const codec = map(t.string, t.number);
            // JSON cannot carry -0 or NaN; the codec itself must.
            const encoded = codec.encode(new Map([['z', -0], ['n', NaN]]));
            const decoded = codec.decode(encoded);
            if (isLeft(decoded)) {
                fail('decode failed');
                return;
            }
            expect([...decoded.right.keys()]).toEqual(['z', 'n']);
            expect(Object.is(decoded.right.get('z'), -0)).toBeTrue();
            expect(Number.isNaN(decoded.right.get('n'))).toBeTrue();
        });

        it('for an empty map', () => {
            expect(map(t.string, t.number).encode(new Map())).toEqual([]);
            expect(roundTrip(map(t.string, t.number), new Map()).size).toBe(0);
        });
    });

    // #84: reduce without an initial value throws on an empty array.
    it('is-guard accepts an empty map', () => {
        expect(map(t.string, t.number).is(new Map())).toBeTrue();
        expect(map(t.string, t.number).is(new Map([['a', 1]]))).toBeTrue();
        expect(map(t.string, t.number).is(new Map([['a', 'b']]))).toBeFalse();
        expect(map(t.string, t.number).is({})).toBeFalse();
    });
});
