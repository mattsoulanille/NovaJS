import 'jasmine';
import { ExtrasOutfitInfo, extrasListing } from './player_info.js';

/**
 * The player-info dialog's Extras page and the Honors page share one
 * partition of the ship's outfits: oütf 0x2000 ("This outfit appears in
 * the Ranks section of the player info dialog instead of in the Extras
 * section", EVN Bible ~:1985) moves an outfit's NAME to Honors without
 * changing what the ship is worth. Two plug-in outfits set it (arpia:479
 * and :493, "Keycard"); no stock outfit does.
 *
 * (The dialog itself needs a DOM for PIXI.Text, so it is tested through
 * the pure partition it delegates to, as player_info_budget_test does.)
 */
describe('the Extras / Honors partition', () => {
    const catalog = new Map<string, ExtrasOutfitInfo>([
        ['test:laser', { name: 'Laser', price: 1_000, builtIn: false,
            showAsRank: false }],
        ['test:keycard', { name: 'Keycard', price: 500, builtIn: false,
            showAsRank: true }],
        ['test:hullgun', { name: 'Hull Gun', price: 9_999, builtIn: true,
            showAsRank: false }],
    ]);
    const info = (id: string) => catalog.get(id);

    it('lists an oütf 0x2000 outfit under Honors and not under Extras',
        () => {
            const listing = extrasListing([
                ['test:laser', { count: 2 }],
                ['test:keycard', { count: 1 }],
            ], info);
            expect(listing.extras).toEqual(['2 x Laser']);
            expect(listing.honors).toEqual(['Keycard']);
        });

    it('still values it in the trade-in total, the way the shipyard does',
        () => {
            // shipyard_rules' tradeInValue prices every traded-in outfit
            // and never reads the flag; the dialog's figure must match.
            expect(extrasListing([
                ['test:laser', { count: 2 }],
                ['test:keycard', { count: 3 }],
            ], info).outfitValue).toBe(2 * 1_000 + 3 * 500);
        });

    it('lists a built-in weapon nowhere and values it at nothing', () => {
        const listing = extrasListing([
            ['test:hullgun', { count: 1 }],
            ['test:laser', { count: 1 }],
        ], info);
        expect(listing.extras).toEqual(['Laser']);
        expect(listing.honors).toEqual([]);
        expect(listing.outfitValue).toBe(1_000);
    });

    it('skips zero counts and falls back to the id for an unknown outfit',
        () => {
            const listing = extrasListing([
                ['test:laser', { count: 0 }],
                ['mystery:1', { count: 2 }],
            ], info);
            expect(listing.extras).toEqual(['2 x mystery:1']);
            expect(listing.honors).toEqual([]);
            expect(listing.outfitValue).toBe(0);
        });

    it('is empty for a ship with no outfit state at all', () => {
        expect(extrasListing(undefined, info))
            .toEqual({ extras: [], honors: [], outfitValue: 0 });
    });
});
