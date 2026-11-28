import 'jasmine';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    NebulaExploredType, resolveNebulaOnExplore,
} from './nebula_explored_record.js';

describe('a nëbu\'s OnExplore', () => {
    const HAZE = SYNTHETIC.nebulae.haze;

    it('carries the bits it sets, sorted, when it changes something', () => {
        expect(resolveNebulaOnExplore(HAZE, `b${BITS.hazeExplored}`, new Set()))
            .toEqual({ nebulaId: HAZE, bitsSet: [BITS.hazeExplored] });
        expect(resolveNebulaOnExplore(HAZE, 'b9 b3 !b5', new Set([5, 7])))
            .toEqual({ nebulaId: HAZE, bitsSet: [3, 9], bitsCleared: [5] });
    });

    it('sends nothing once its bits are already as it leaves them, so '
        + 'testing a nebula again changes nothing (the Bible: it "may get '
        + 'evaluated multiple times")', () => {
            const bits = new Set([BITS.hazeExplored]);
            expect(resolveNebulaOnExplore(HAZE, `b${BITS.hazeExplored}`, bits))
                .toBeUndefined();
            expect(resolveNebulaOnExplore(HAZE, '!b4', new Set([1])))
                .toBeUndefined();
            expect(resolveNebulaOnExplore(HAZE, '', new Set())).toBeUndefined();
            expect(resolveNebulaOnExplore(HAZE, '   ', new Set())).toBeUndefined();
        });

    it('never touches the caller\'s set', () => {
        const bits = new Set([5]);
        resolveNebulaOnExplore(HAZE, 'b1 !b5', bits);
        expect([...bits]).toEqual([5]);
    });

    it('runs only the bit operators; R() always takes its first choice', () => {
        const warn = spyOn(console, 'warn');
        // G (grant outfit) is not a bit operator: ignored, the bit still set.
        expect(resolveNebulaOnExplore(HAZE, 'G130 b2', new Set()))
            .toEqual({ nebulaId: HAZE, bitsSet: [2] });
        for (let i = 0; i < 5; i++) {
            expect(resolveNebulaOnExplore(HAZE, 'R(b10 b11)', new Set()))
                .toEqual({ nebulaId: HAZE, bitsSet: [10] });
        }
        warn.and.callThrough();
    });

    it('changes nothing for a string that does not parse', () => {
        const warn = spyOn(console, 'warn');
        expect(resolveNebulaOnExplore(HAZE, 'b(((', new Set())).toBeUndefined();
        warn.and.callThrough();
    });

    it('is a JSON-safe record the input codec accepts and checks', () => {
        const record = resolveNebulaOnExplore(HAZE, 'b1 !b2', new Set([2]))!;
        expect(isRight(NebulaExploredType.decode(
            JSON.parse(JSON.stringify(record))))).toBeTrue();
        expect(isLeft(NebulaExploredType.decode({ bitsSet: [1] }))).toBeTrue();
        expect(isLeft(NebulaExploredType.decode(
            { nebulaId: HAZE, bitsSet: ['1'] }))).toBeTrue();
    });
});
