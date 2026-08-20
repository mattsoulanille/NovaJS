import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import {
    canBuyOutfit,
    OutfitterContext,
    stellarOf,
    visibleOutfits,
} from './outfitter_rules.js';

/**
 * The grid the Outfitter menu builds for a mock planet, exercised through
 * the same composition the menu performs: PlanetData -> stellarOf ->
 * visibleOutfits, then canBuyOutfit per surviving item to decide which
 * render greyed. (The Outfitter class itself is PIXI-bound, so as
 * elsewhere in this package the logic is tested through the pure
 * functions it delegates to.)
 */
describe('outfitter grid on a mock planet', () => {
    function planet(fields: Partial<PlanetData> = {},
        flags: Partial<PlanetData['flags']> = {}): PlanetData {
        const base = getDefaultPlanetData();
        return {
            ...base, ...fields,
            flags: { ...base.flags, hasOutfitter: true, ...flags },
        };
    }

    function outfit(id: string, fields: Partial<OutfitData> = {}): OutfitData {
        return {
            ...getDefaultOutfitData(), id, ...fields,
            physics: { freeMass: 0 },
        };
    }

    function context(outfits: OutfitData[], data: PlanetData,
        owned: [string, number][] = [], credits = Infinity): OutfitterContext {
        const byId = new Map(outfits.map(o => [o.id, o]));
        const ship = getDefaultShipData();
        ship.physics = { ...ship.physics, freeMass: 1000 };
        return {
            shipData: ship,
            outfits: new Map(owned),
            getOutfit: id => byId.get(id),
            getWeapon: () => undefined,
            bits: new Set(),
            credits,
            planet: stellarOf(data),
        };
    }

    /** What the grid renders: each visible tile and whether it is greyed. */
    function grid(outfits: OutfitData[], ctx: OutfitterContext) {
        return visibleOutfits(outfits, ctx).map(o => ({
            id: o.id,
            greyed: !canBuyOutfit(o, ctx).allowed,
        }));
    }

    it('stocks a mock planet by tech level and SpecialTech', () => {
        const outfits = [
            outfit('nova:128', { techLevel: 1, displayWeight: 10 }),
            outfit('nova:129', { techLevel: 9, displayWeight: 9 }),
            outfit('nova:130', { techLevel: 81, displayWeight: 8 }),
        ];
        const world = planet({ techLevel: 2, specialTech: [81] });
        expect(grid(outfits, context(outfits, world))).toEqual([
            { id: 'nova:128', greyed: false },
            { id: 'nova:130', greyed: false },
        ]);
    });

    it('greys an unavailable item rather than dropping it from the grid',
        () => {
            const outfits = [
                outfit('nova:128', { techLevel: 1, availability: 'b100' }),
                outfit('nova:129', { techLevel: 1 }),
            ];
            const world = planet({ techLevel: 5 });
            expect(grid(outfits, context(outfits, world))).toEqual([
                { id: 'nova:128', greyed: true },
                { id: 'nova:129', greyed: false },
            ]);
        });

    it('greys an item the player cannot afford but still shows it', () => {
        const outfits = [outfit('nova:128', { techLevel: 1, price: 5000 })];
        const world = planet({ techLevel: 5 });
        expect(grid(outfits, context(outfits, world, [], 10))).toEqual([
            { id: 'nova:128', greyed: true },
        ]);
    });

    it('drops a 0x4000 item whose Availability fails', () => {
        const outfits = [
            outfit('nova:128', {
                techLevel: 1, hideUnlessAvailable: true, availability: 'b100',
            }),
            outfit('nova:129', { techLevel: 1 }),
        ];
        const world = planet({ techLevel: 5 });
        expect(grid(outfits, context(outfits, world)).map(t => t.id))
            .toEqual(['nova:129']);
    });

    it('shows an owned high-tech outfit at a buys-anything planet', () => {
        const outfits = [outfit('nova:128', { techLevel: 9999 })];
        const world = planet({ techLevel: 0 }, { buysAnyOutfit: true });
        // Visible so it can be sold, but greyed: it cannot be bought here.
        expect(grid(outfits, context(outfits, world, [['nova:128', 1]])))
            .toEqual([{ id: 'nova:128', greyed: true }]);
    });

    it('leaves that same outfit out at an ordinary planet', () => {
        const outfits = [outfit('nova:128', { techLevel: 9999 })];
        const world = planet({ techLevel: 0 });
        expect(grid(outfits, context(outfits, world, [['nova:128', 1]])))
            .toEqual([]);
    });

    it('maps a planet with no SpecialTech to a plain tech threshold', () => {
        const world = planet({ techLevel: 3 });
        expect(stellarOf(world)).toEqual({
            techLevel: 3, specialTech: [], buysAnyOutfit: false,
        });
    });

    it('carries the Flags2 buys-anything bit into the rules', () => {
        const world = planet({ techLevel: 0, specialTech: [42] },
            { buysAnyOutfit: true });
        expect(stellarOf(world)).toEqual({
            techLevel: 0, specialTech: [42], buysAnyOutfit: true,
        });
    });

    it('does NOT carry the owning govt: no rank prices this shop', () => {
        // The outfitter has nothing for a ränk PriceMod to match against —
        // PriceMod bends ship prices, not outfit prices (price_mod.ts).
        const world = planet({ techLevel: 3 });
        world.govt = 'nova:144';
        expect(Object.keys(stellarOf(world)).sort())
            .toEqual(['buysAnyOutfit', 'specialTech', 'techLevel']);
    });
});
