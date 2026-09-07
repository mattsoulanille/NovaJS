import 'jasmine';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { deriveShipPhysics } from '../nova_plugin/ship/index.js';
import {
    canBuyOutfit, freeMass, installedMass, outfitPrice, OutfitterContext,
} from './outfitter_rules.js';

/**
 * oütf flags 0x0200 / 0x0400 (price and mass proportional to the player's
 * ship's mass) against the REAL stock data, pinned to the original-hardware
 * capture ui_screenshots/original_macos_screenshots/outfitter/
 * earth_outfitter_carbon_fiber_cant_hold_any_more.png: Carbon Fiber (oütf
 * 180, Cost 250, Mass 1, flags 0x0600) at Earth reads "Item Price: 6,250
 * cr" and "Item Mass: 1 ton" — 6,250 = 250 x 25, and the only mass-25
 * stock hull a pilot can be flying is the Heavy Shuttle (shïp 129).
 */
describe('ship-mass-proportional outfits against real Nova data', () => {
    const CARBON_FIBER = 'nova:180';
    const SPUN_DIAMOND = 'nova:183';
    /** Heavy Shuttle, Mass 25. */
    const HEAVY_SHUTTLE = 'nova:129';
    /** Leviathan, Mass 10,000. */
    const LEVIATHAN = 'nova:131';

    async function contextFor(shipId: string,
        owned: [string, number][] = []): Promise<OutfitterContext> {
        const gameData = await getIntegrationGameData();
        const shipData = await gameData.data.Ship.get(shipId);
        const ids = (await gameData.ids).Outfit;
        const outfits = new Map(await Promise.all(ids.map(async id =>
            [id, await gameData.data.Outfit.get(id)] as const)));
        return {
            shipData,
            outfits: new Map(owned),
            getOutfit: id => outfits.get(id),
            getWeapon: () => undefined,
            bits: new Set<number>(),
            credits: Infinity,
        };
    }

    it('decodes both bits on every stock armour plating', async () => {
        const context = await contextFor(HEAVY_SHUTTLE);
        for (const id of [CARBON_FIBER, 'nova:181', 'nova:182', SPUN_DIAMOND]) {
            const outfit = context.getOutfit(id)!;
            expect(outfit.priceScalesWithShipMass).withContext(id).toBe(true);
            expect(outfit.massScalesWithShipMass).withContext(id).toBe(true);
        }
        // ...and not on an ordinary weapon.
        expect(context.getOutfit('nova:129')!.priceScalesWithShipMass)
            .toBe(false);
    });

    it('quotes Carbon Fiber at 6,250 cr and 1 ton on the Heavy Shuttle',
        async () => {
            const context = await contextFor(HEAVY_SHUTTLE);
            const plating = context.getOutfit(CARBON_FIBER)!;
            expect(context.shipData.physics.mass).toBe(25);
            expect(outfitPrice(plating, context.shipData)).toBe(6_250);
            expect(installedMass(plating, context.shipData)).toBe(1);
        });

    it('charges a Leviathan 2,500,000 cr for a 100-ton plate', async () => {
        const context = await contextFor(LEVIATHAN);
        const plating = context.getOutfit(CARBON_FIBER)!;
        expect(context.shipData.physics.mass).toBe(10_000);
        expect(outfitPrice(plating, context.shipData)).toBe(2_500_000);
        expect(installedMass(plating, context.shipData)).toBe(100);
        expect(outfitPrice(context.getOutfit(SPUN_DIAMOND)!, context.shipData))
            .toBe(25_000_000);
    });

    it('takes the scaled tonnage off the hull in the shop AND the sim',
        async () => {
            const gameData = await getIntegrationGameData();
            const context = await contextFor(LEVIATHAN, [[CARBON_FIBER, 2]]);
            const bare = context.shipData.physics.freeMass;
            expect(freeMass(context)).toBe(bare - 200);
            // The sim's own derivation agrees with the shop's arithmetic.
            const physics = deriveShipPhysics(context.shipData, gameData,
                new Map([[CARBON_FIBER, { count: 2 }]]));
            expect(physics?.freeMass).toBe(bare - 200);
            // 20 tons of hull space cannot take a third 100-ton plate.
            expect(canBuyOutfit(context.getOutfit(CARBON_FIBER)!, {
                ...context, credits: Infinity,
                bits: new Set([1]),
            }).allowed).toBe(false);
        });
});
