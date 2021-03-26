import { isLeft } from 'fp-ts/lib/Either';
import * as t from 'io-ts';
import 'jasmine';
import { map } from './map';


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
});
