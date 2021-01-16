import { isLeft } from 'fp-ts/lib/Either';
import 'jasmine';
import { Position, PositionType } from './position';

describe('Position', () => {
    it('adds positions', () => {
        const v1 = new Position(3, 4);
        const v2 = new Position(7, 9);

        const sum = v1.add(v2);

        expect(sum).toEqual(new Position(10, 13));
        expect(v1).toEqual(new Position(3, 4));
        expect(v2).toEqual(new Position(7, 9));
    });

    it('PositionType decodes into Position', () => {
        const vec = { x: 123, y: 456 };
        const decoded = PositionType.decode(vec);

        if (isLeft(decoded)) {
            fail('Failed to decode position');
            return;
        }

        const position = decoded.right;
        expect(position).toBeInstanceOf(Position);
        expect(position.x).toEqual(vec.x);
        expect(position.y).toEqual(vec.y);
    });

    it('returns positions from its methods', () => {
        const pos = new Position(1, 2);
        expect(pos.scale(1)).toBeInstanceOf(Position);
    })
});
