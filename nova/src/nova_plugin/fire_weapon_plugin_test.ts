import { Angle } from 'nova_ecs/datatypes/angle';
import { getEvenlySpacedAngles } from './fire_weapon_plugin';

describe('getEvenlySpacedAngles', () => {
    it('gets an even number of evenly spaced angles', () => {
        const actual = getEvenlySpacedAngles(0.6, 4);
        const expected = [
            new Angle(0.3),
            new Angle(-0.3),
            new Angle(0.9),
            new Angle(-0.9),
        ];
        expect(actual).toEqual(expected);
    });

    it('gets an odd number of evenly spaced angles', () => {
        const actual = getEvenlySpacedAngles(0.6, 5);
        const expected = [
            new Angle(0),
            new Angle(0.6),
            new Angle(-0.6),
            new Angle(1.2),
            new Angle(-1.2),
        ];
        expect(actual).toEqual(expected);
    });
});
