import 'jasmine';
import { targetReadout } from './target_readout.js';

describe('targetReadout (status bar target pane rule)', () => {
    it("a disabled target reads 'Disabled', hiding the percent even " +
        'when shield/armor values exist', () => {
            expect(targetReadout(true, 50, 80)).toEqual({ kind: 'disabled' });
            expect(targetReadout(true, 0, 10)).toEqual({ kind: 'disabled' });
            expect(targetReadout(true)).toEqual({ kind: 'disabled' });
        });

    it('shows shield percent while any shield remains', () => {
        expect(targetReadout(false, 73, 100))
            .toEqual({ kind: 'shield', percent: 73 });
    });

    it('falls back to armor percent once shields are gone', () => {
        expect(targetReadout(false, 0, 42))
            .toEqual({ kind: 'armor', percent: 42 });
        expect(targetReadout(false, undefined, 42))
            .toEqual({ kind: 'armor', percent: 42 });
    });

    it('shows nothing without stats', () => {
        expect(targetReadout(false)).toEqual({ kind: 'none' });
    });

    it('reads 0% for a hull with no armor at all, never NaN%', () => {
        // Stat.percent is current / max * 100: NaN when max is 0, which
        // the stock Escape Pod (shïp nova:895, shield 0 / armor 0) is.
        expect(targetReadout(false, NaN, NaN))
            .toEqual({ kind: 'armor', percent: 0 });
    });
});
