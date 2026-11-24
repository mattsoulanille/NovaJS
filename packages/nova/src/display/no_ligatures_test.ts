import 'jasmine';
import {
    breakLigatures, NO_LIGATURES_CSS, patchTextContext, ZWNJ,
} from './no_ligatures.js';

/**
 * The original never ligates (its bitmap Geneva draws "fi" as f + dotted
 * i); NovaJS breaks every pair its outline fonts could ligate with a
 * ZWNJ at draw time. The browser behaviour itself (Geneva's fi/fl
 * ligatures disappearing, widths becoming f + i) is checked in a real
 * Chrome, not here.
 */
describe('no ligatures', () => {
    describe('breakLigatures', () => {
        it('splits fi, fl, ff, fj and the ffi/ffl triples', () => {
            expect(breakLigatures('find')).toBe(`f${ZWNJ}ind`);
            expect(breakLigatures('fleet')).toBe(`f${ZWNJ}leet`);
            expect(breakLigatures('staff')).toBe(`staf${ZWNJ}f`);
            expect(breakLigatures('fjord')).toBe(`f${ZWNJ}jord`);
            expect(breakLigatures('Office'))
                .toBe(`Of${ZWNJ}f${ZWNJ}ice`);
            expect(breakLigatures('effluent'))
                .toBe(`ef${ZWNJ}f${ZWNJ}luent`);
        });

        it('leaves strings with nothing to ligate unchanged', () => {
            for (const s of ['', 'Arbiter', 'of the', 'if.', 'aft',
                'FIGHT', 'Fight', '1,000 cr']) {
                expect(breakLigatures(s)).toBe(s);
            }
        });

        it('only ever inserts ZWNJ, so the visible text is the same', () => {
            const s = 'The fighters fled the field; find the officer first.';
            expect(breakLigatures(s).split(ZWNJ).join('')).toBe(s);
            expect(breakLigatures(breakLigatures(s)))
                .toBe(breakLigatures(s));
        });
    });

    describe('patchTextContext', () => {
        function fakeContext() {
            const seen: string[] = [];
            class Ctx {
                fillText(text: string, _x: number, _y: number) {
                    seen.push(`fill:${text}`);
                }
                strokeText(text: string, _x: number, _y: number) {
                    seen.push(`stroke:${text}`);
                }
                measureText(text: string) {
                    seen.push(`measure:${text}`);
                    return { width: text.length };
                }
            }
            return { Ctx, seen };
        }

        it('routes fill, stroke and measure through breakLigatures', () => {
            const { Ctx, seen } = fakeContext();
            patchTextContext(Ctx.prototype);
            const ctx = new Ctx();
            ctx.fillText('fight', 1, 2);
            ctx.strokeText('fly', 1, 2);
            expect((ctx.measureText('fire') as { width: number }).width)
                .toBe(5);
            expect(seen).toEqual([
                `fill:f${ZWNJ}ight`, `stroke:f${ZWNJ}ly`,
                `measure:f${ZWNJ}ire`,
            ]);
        });

        it('is idempotent', () => {
            const { Ctx, seen } = fakeContext();
            patchTextContext(Ctx.prototype);
            patchTextContext(Ctx.prototype);
            new Ctx().fillText('fi', 0, 0);
            expect(seen).toEqual([`fill:f${ZWNJ}i`]);
        });
    });

    it('turns DOM ligatures off for every element, over font shorthands',
        () => {
            expect(NO_LIGATURES_CSS).toContain('*');
            expect(NO_LIGATURES_CSS)
                .toContain('font-variant-ligatures: none !important');
        });
});
