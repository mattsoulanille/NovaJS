import 'jasmine';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import { openEnum } from './open_enum.js';

describe('openEnum', () => {
    const Colour = openEnum('Colour', ['red', 'green'] as const);

    it('decodes every declared member to itself', () => {
        for (const member of Colour.members) {
            const decoded = Colour.decode(member);
            if (isLeft(decoded)) {
                fail(`${member} did not decode`);
                return;
            }
            expect(decoded.right).toBe(member);
        }
    });

    it('encodes a member as the same string (byte-identical to t.string)',
        () => {
            expect(Colour.encode('red')).toBe('red');
        });

    it('tolerates an unknown string, carrying it through untouched', () => {
        // The additive-wire contract: a name from a newer build neither
        // fails the decode nor gets remapped, so a re-encode writes back
        // exactly what was read.
        const decoded = Colour.decode('ultraviolet');
        expect(isRight(decoded)).toBeTrue();
        if (isRight(decoded)) {
            expect(decoded.right as string).toBe('ultraviolet');
            expect(Colour.encode(decoded.right)).toBe('ultraviolet');
        }
    });

    it('rejects non-strings as t.string did', () => {
        expect(isLeft(Colour.decode(3))).toBeTrue();
        expect(isLeft(Colour.decode(undefined))).toBeTrue();
        expect(isLeft(Colour.decode({ red: true }))).toBeTrue();
    });

    it('exposes its members for the per-site specs', () => {
        expect(Colour.members).toEqual(['red', 'green']);
    });
});
