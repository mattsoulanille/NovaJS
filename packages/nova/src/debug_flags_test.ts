import 'jasmine';
import { DEBUG_FLAGS, tradeOverrideEnabled } from './debug_flags.js';

/**
 * The outfitter's shift+click trade override: on for development (the
 * standing ruling), off for a production bundle unless the page asks for
 * it with `?debug`.
 */
describe('DEBUG_FLAGS.tradeOverride', () => {
    it('is on in every non-production build', () => {
        expect(tradeOverrideEnabled(undefined, false)).toBe(true);
        expect(tradeOverrideEnabled('development', false)).toBe(true);
        expect(tradeOverrideEnabled('test', false)).toBe(true);
    });

    it('is off in a production build unless ?debug is in the URL', () => {
        expect(tradeOverrideEnabled('production', false)).toBe(false);
        expect(tradeOverrideEnabled('production', true)).toBe(true);
    });

    it('is on under the spec runner (not a production build)', () => {
        expect(process.env.NODE_ENV).not.toBe('production');
        expect(DEBUG_FLAGS.tradeOverride).toBe(true);
    });
});
