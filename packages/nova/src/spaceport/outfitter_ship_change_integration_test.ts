import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { CargoComponent } from '../nova_plugin/ship/cargo_plugin.js';
import { ControlEvent } from '../nova_plugin/core/controls_plugin.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import { CreditsComponent } from '../nova_plugin/player/player_state_plugin.js';
import { ShipComponent } from '../nova_plugin/ship/ship_plugin.js';
import { creditBalance } from './credit_commit.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Outfitter } from './outfitter.js';
import {
    canBuyOutfit, OutfitterContext, outfitPrice, outfitResaleValue, ownedCount,
} from './outfitter_rules.js';

/**
 * ============================================================================
 * THE STOCK SHIP-UPGRADE PERMITS: oütf 0x0010 AND THE `Hxxx` OPERATOR
 * ============================================================================
 *
 * Stock oütf 314 "Chrome Valk Upgrade" is a 50,000 cr permit (Require: a
 * Valkyrie hull, Availability `b4000 & P30`, flags 0x4110) whose whole
 * effect is its OnPurchase, `H165`: "change the player's ship to ship type
 * 165 [Mod Starbridge]. The player will lose any nonpersistent outfit items
 * he previously had, but will be given all of the default weapons and items
 * that come with ship type xxx" (EVN Bible ~:238). And flag 0x0010 —
 * "Remove any items of this type after purchase (useful for permits and
 * other intangible purchases)" (~:1966) — means the permit itself never
 * stays aboard.
 *
 * Before this landed the purchase charged 50,000, logged a missing-hook
 * warning, left the pilot in the Valkyrie with the permit sitting in the
 * outfit list at Max 1, and refunded 25,000 on Sell. These drive the REAL
 * Outfitter (headless PIXI, real Nova data) through the buy.
 */
describe('a ship-upgrade permit bought at the real outfitter', () => {
    beforeAll(() => installHeadlessPixi());

    /** Valkyrie -> Mod Starbridge, via "Chrome Valk Upgrade". */
    const VALKYRIE = 'nova:137';
    const MOD_STARBRIDGE = 'nova:165';
    const CHROME_VALK_UPGRADE = 'nova:314';
    /** "Fuel Transfer": 0 cr, Max 1, flag 0x0010, no OnPurchase. */
    const FUEL_TRANSFER = 'nova:236';
    /** A Valkyrie's stock Medium Blaster — a NONpersistent outfit. */
    const MEDIUM_BLASTER = 'nova:129';

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {},
        } as unknown as DisplayAssetDataInterface;
    }

    async function untilShown(menu: { container: PIXI.Container }) {
        for (let i = 0; i < 6000 && !menu.container.visible; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(menu.container.visible).toBe(true);
    }

    /** A landed Valkyrie pilot with the plot bit the permit needs. */
    async function dockedValkyrie(credits: number): Promise<Entity> {
        const gameData = await getIntegrationGameData();
        const entity = makeShip(await gameData.data.Ship.get(VALKYRIE));
        entity.components.set(CreditsComponent, { credits });
        entity.components.set(CargoComponent, new Map());
        entity.components.set(ControlBitsComponent, new Set<number>([4000]));
        // The Valkyrie's stock loadout, as ShipOutfitsProvider derives it.
        entity.components.set(OutfitsStateComponent,
            new Map([[MEDIUM_BLASTER, { count: 1 }]]));
        return entity;
    }

    it('changes the hull to the Mod Starbridge (H165), drops the '
        + 'nonpersistent outfits, grants the defaults and removes the permit',
        async () => {
            const gameData = await getIntegrationGameData();
            const entity = await dockedValkyrie(100_000);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;
            const swaps: Entity[] = [];
            outfitter.onShipChanged = ship => swaps.push(ship);

            const shown = outfitter.show(entity);
            await untilShown(outfitter);
            const permit = await gameData.data.Outfit.get(CHROME_VALK_UPGRADE);
            expect(permit.removeAfterPurchase).toBe(true);
            expect(permit.onPurchase).toBe('H165');
            (outfitter as any).applyBuy(permit);

            // The swap is published at the click, like a shipyard's.
            expect(swaps.length).toBe(1);
            const changed = swaps[0];
            expect(changed).not.toBe(entity);
            expect(changed.components.get(ShipComponent)?.id)
                .toBe(MOD_STARBRIDGE);
            // The outfitter now shops for the new hull.
            expect((outfitter as any).shipData.id).toBe(MOD_STARBRIDGE);
            const working: Map<string, number> = (outfitter as any).outfits;
            // 0x0010: the permit is gone (and so cannot be sold back).
            expect(working.get(CHROME_VALK_UPGRADE) ?? 0).toBe(0);
            // H: the Mod Starbridge's defaults are aboard...
            const modStarbridge = await gameData.data.Ship.get(MOD_STARBRIDGE);
            for (const [id, count] of Object.entries(modStarbridge.outfits)) {
                expect(working.get(id)).withContext(id).toBe(count);
            }

            outfitter.dismiss();
            const departed = await shown;
            // Done hands back the NEW entity, with the visit's spend
            // applied to it and the permit nowhere in its outfits.
            expect(departed).toBe(changed);
            expect(creditBalance(departed)).toBe(50_000);
            expect(departed.components.get(OutfitsStateComponent)!
                .has(CHROME_VALK_UPGRADE)).toBe(false);
            expect(departed.components.get(OutfitsStateComponent)!
                .get(MEDIUM_BLASTER)?.count)
                .toBe(modStarbridge.outfits[MEDIUM_BLASTER]);
            // The plot bit rode along on the new hull.
            expect(departed.components.get(ControlBitsComponent)!.has(4000))
                .toBe(true);
            // ...and the traded-away hull was left untouched.
            expect(creditBalance(entity)).toBe(100_000);
        }, 120_000);

    it('takes a 0x0010 item without an OnPurchase straight back off the '
        + 'ship, so its Max of 1 never blocks a repeat purchase', async () => {
            const gameData = await getIntegrationGameData();
            const entity = await dockedValkyrie(1_000);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;
            const shown = outfitter.show(entity);
            await untilShown(outfitter);

            const fuelTransfer = await gameData.data.Outfit.get(FUEL_TRANSFER);
            expect(fuelTransfer.removeAfterPurchase).toBe(true);
            expect(fuelTransfer.max).toBe(1);
            (outfitter as any).applyBuy(fuelTransfer);
            (outfitter as any).applyBuy(fuelTransfer);
            const working: Map<string, number> = (outfitter as any).outfits;
            expect(working.has(FUEL_TRANSFER)).toBe(false);
            const context: OutfitterContext = (outfitter as any).makeContext();
            expect(ownedCount(FUEL_TRANSFER, context)).toBe(0);
            // Stock never puts Fuel Transfer on a shelf (BuyRandom 0), so
            // the shop refuses it for THAT reason and never for its Max.
            const check = canBuyOutfit(fuelTransfer,
                { ...context, credits: Infinity });
            expect(check.allowed ? '' : check.reason).toBe('notStocked');
            expect(check.allowed ? '' : check.reason).not.toBe('maxCount');

            outfitter.dismiss();
            const departed = await shown;
            expect(departed.components.get(OutfitsStateComponent)!
                .has(FUEL_TRANSFER)).toBe(false);
        }, 120_000);

    it('keeps its working outfit copy to the outfits actually owned after '
        + 'a grid refresh', async () => {
            // The working copy is a DefaultMap; the rules used to be
            // handed it directly, and visibleOutfits' get() on every
            // outfit in the game inserted all 242 ids at count 0.
            const gameData = await getIntegrationGameData();
            const entity = await dockedValkyrie(1_000);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;
            const shown = outfitter.show(entity);
            await untilShown(outfitter);
            (outfitter as any).refreshGrid();
            (outfitter as any).refreshTradeState();
            const working: Map<string, number> = (outfitter as any).outfits;
            expect([...working.keys()]).toEqual([MEDIUM_BLASTER]);
            const context: OutfitterContext = (outfitter as any).makeContext();
            expect([...context.outfits.keys()]).toEqual([MEDIUM_BLASTER]);
            outfitter.dismiss();
            await shown;
        }, 120_000);

    it('charges a unit a build order\'s Dxxx consumes against THIS visit\'s '
        + 'receipt, so the pre-owned unit sells back at resale, not at cost',
        async () => {
            // The pilot owns one Medium Blaster, buys a second (a same-visit
            // receipt: selling it back would refund 100%), then buys a
            // build order in the BYOM:455 "Dismantle" mould — a 0x0010
            // permit whose OnPurchase is `D129`, one Medium Blaster gone.
            // One blaster is left aboard and one was paid for this visit;
            // the unit the order dismantled spends that receipt. Otherwise
            // the survivor — the pre-owned one — sells at the full price
            // the consumed one was bought for, and the player is 75% of a
            // blaster ahead for having dismantled it.
            const gameData = await getIntegrationGameData();
            const entity = await dockedValkyrie(100_000);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;
            const shown = outfitter.show(entity);
            await untilShown(outfitter);

            const blaster = await gameData.data.Outfit.get(MEDIUM_BLASTER);
            const ship = (outfitter as any).shipData;
            const dismantle = {
                ...await gameData.data.Outfit.get(FUEL_TRANSFER),
                id: 'nova:9129', name: 'Dismantle Medium Blaster',
                price: 0, onPurchase: 'D129',
            };
            expect(dismantle.removeAfterPurchase).toBe(true);
            // (Re-read the working copy after each buy: an OnPurchase that
            // runs through the mission session replaces the map.)
            const working = (): Map<string, number> => (outfitter as any).outfits;
            (outfitter as any).applyBuy(blaster);
            expect(working().get(MEDIUM_BLASTER)).toBe(2);
            (outfitter as any).applyBuy(dismantle);
            expect(working().get(MEDIUM_BLASTER)).toBe(1);
            expect(working().has(dismantle.id)).toBe(false);
            const receipts: Map<string, number> =
                (outfitter as any).visitPurchases;
            expect(receipts.get(MEDIUM_BLASTER) ?? 0).toBe(0);

            const before = (outfitter as any).credits.credits;
            (outfitter as any).applySell(blaster);
            expect((outfitter as any).credits.credits - before)
                .toBe(outfitResaleValue(blaster, ship));
            expect(outfitResaleValue(blaster, ship))
                .toBeLessThan(outfitPrice(blaster, ship));

            outfitter.dismiss();
            await shown;
        }, 120_000);
});
