import { isLeft } from 'fp-ts/lib/Either';
import produce, { applyPatches, enablePatches, produceWithPatches } from 'immer';
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

    it('is immerable', () => {
        const vec = new Vector(3, 5);
        const hasVec = {
            vector: vec
        };
        const next = produce(hasVec, draft => {
            draft.vector = draft.vector.add({ x: 7, y: -3 });
        });
        expect(next.vector).toEqual(new Vector(10, 2));
        expect(next.vector.add({ x: 10, y: 10 })).toEqual(new Vector(20, 12));
    });

    it('can be encoded in a patch', () => {
        enablePatches();
        const hasVec: { [index: string]: Vector } = {};
        const [, patches] = produceWithPatches(hasVec, draft => {
            draft.vector = new Vector(1, 2);
        });

        const next = applyPatches(hasVec, patches);
        expect(next.vector).toEqual(new Vector(1, 2));
        expect(next.vector.add({ x: 10, y: 10 })).toEqual(new Vector(11, 12));
    });
});

