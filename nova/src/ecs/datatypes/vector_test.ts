import { isLeft } from 'fp-ts/lib/Either';
import 'jasmine';
import { Vector, VectorType } from './vector';

describe('Vector', () => {
    it('adds vectors', () => {
        const v1 = new Vector(3, 4);
        const v2 = new Vector(7, 9);

        const sum = v1.add(v2);

        expect(sum).toEqual(new Vector(10, 13));
        expect(v1).toEqual(new Vector(3, 4));
        expect(v2).toEqual(new Vector(7, 9));
    });
    it('VectorType decodes into Vector', () => {
        const vec = { x: 123, y: 456 };
        const decoded = VectorType.decode(vec);

        if (isLeft(decoded)) {
            fail('Failed to decode vector');
            return;
        }

        const vector = decoded.right;
        expect(vector).toBeInstanceOf(Vector);
        expect(vector.x).toEqual(vec.x);
        expect(vector.y).toEqual(vec.y);
    });
});
