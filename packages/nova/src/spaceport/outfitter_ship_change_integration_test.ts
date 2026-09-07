import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
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
 * SHIP-UPGRADE PERMITS: oütf 0x0010 AND THE `Hxxx` OPERATOR
 * ============================================================================
 *
 * A ship-upgrade permit is an outfit whose whole effect is its OnPurchase
 * `Hxxx`: "change the player's ship to ship type xxx. The player will lose
 * any nonpersistent outfit items he previously had, but will be given all
 * of the default weapons and items that come with ship type xxx" (EVN
 * Bible ~:238). And flag 0x0010 — "Remove any items of this type after
 * purchase (useful for permits and other intangible purchases)" (~:1966)
 * — means the permit itself never stays aboard. Stock oütf 314 "Chrome
 * Valk Upgrade" (50,000 cr, `H165`) is the shipped example; the synthetic
 * scenario's Warden Refit is the same shape, and is what these drive.
 *
 * Before this landed the purchase charged its 50,000, logged a
 * missing-hook warning, left the pilot in the old hull with the permit
 * sitting in the outfit list at Max 1, and refunded 25,000 on Sell. These
 * drive the REAL Outfitter (headless PIXI, parsed data) through the buy.
 */
describe('a ship-upgrade permit bought at the real outfitter', () => {
    beforeAll(() => installHeadlessPixi());

    /** Wren Skiff -> Heron Warden, via the "Warden Refit" (50,000 cr, H130). */
    const SKIFF = SYNTHETIC.ships.skiff;
    const WARDEN = SYNTHETIC.ships.warden;
    const WARDEN_REFIT = SYNTHETIC.outfits.wardenRefit;
    /** "Dock Voucher": Max 1, flag 0x0010, BuyRandom 0, no OnPurchase. */
    const DOCK_VOUCHER = SYNTHETIC.outfits.dockVoucher;
    /** The skiff's own Pulse Blaster — a NONpersistent, resellable gun. */
    const PULSE_BLASTER = SYNTHETIC.outfits.blaster;
    /**
     * A NONpersistent outfit the pilot owns ONE of and the Warden's own
     * loadout carries TWO of: what the new hull's defaults must overwrite.
     */
    const SHIELD_CAPACITOR = SYNTHETIC.outfits.shieldCapacitor;

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

    /** A landed skiff pilot carrying a plot bit that must ride along. */
    async function dockedSkiff(credits: number): Promise<Entity> {
        const gameData = await getSyntheticGameData();
        const entity = makeShip(await gameData.data.Ship.get(SKIFF));
        entity.components.set(CreditsComponent, { credits });
        entity.components.set(CargoComponent, new Map());
        entity.components.set(ControlBitsComponent,
            new Set<number>([BITS.surveyAccepted]));
        // The skiff's own gun, plus one shield capacitor bought along the
        // way — both nonpersistent, so neither survives an Hxxx as owned.
        entity.components.set(OutfitsStateComponent, new Map([
            [PULSE_BLASTER, { count: 1 }],
            [SHIELD_CAPACITOR, { count: 1 }],
        ]));
        return entity;
    }

    it('changes the hull to the Heron Warden (H130), drops the '
        + 'nonpersistent outfits, grants the defaults and removes the permit',
        async () => {
            const gameData = await getSyntheticGameData();
            const entity = await dockedSkiff(100_000);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;
            const swaps: Entity[] = [];
            outfitter.onShipChanged = ship => swaps.push(ship);

            const shown = outfitter.show(entity);
            await untilShown(outfitter);
            const permit = await gameData.data.Outfit.get(WARDEN_REFIT);
            expect(permit.removeAfterPurchase).toBe(true);
            expect(permit.onPurchase).toBe('H130');
            (outfitter as any).applyBuy(permit);

            // The swap is published at the click, like a shipyard's.
            expect(swaps.length).toBe(1);
            const changed = swaps[0];
            expect(changed).not.toBe(entity);
            expect(changed.components.get(ShipComponent)?.id).toBe(WARDEN);
            // The outfitter now shops for the new hull.
            expect((outfitter as any).shipData.id).toBe(WARDEN);
            const working: Map<string, number> = (outfitter as any).outfits;
            // 0x0010: the permit is gone (and so cannot be sold back).
            expect(working.get(WARDEN_REFIT) ?? 0).toBe(0);
            // H: the Heron Warden's defaults are aboard...
            const warden = await gameData.data.Ship.get(WARDEN);
            for (const [id, count] of Object.entries(warden.outfits)) {
                expect(working.get(id)).withContext(id).toBe(count);
            }

            outfitter.dismiss();
            const departed = await shown;
            // Done hands back the NEW entity, with the visit's spend
            // applied to it and the permit nowhere in its outfits.
            expect(departed).toBe(changed);
            // 100,000 less the refit's 50,000.
            expect(creditBalance(departed)).toBe(50_000);
            expect(departed.components.get(OutfitsStateComponent)!
                .has(WARDEN_REFIT)).toBe(false);
            // The pilot's ONE capacitor was replaced by the Warden's two,
            // not added to; and the skiff's gun, which the Warden does not
            // carry, is gone.
            expect(warden.outfits[SHIELD_CAPACITOR]).toBe(2);
            expect(departed.components.get(OutfitsStateComponent)!
                .get(SHIELD_CAPACITOR)?.count)
                .toBe(warden.outfits[SHIELD_CAPACITOR]);
            expect(departed.components.get(OutfitsStateComponent)!
                .has(PULSE_BLASTER)).toBe(false);
            // The plot bit rode along on the new hull.
            expect(departed.components.get(ControlBitsComponent)!
                .has(BITS.surveyAccepted)).toBe(true);
            // ...and the traded-away hull was left untouched.
            expect(creditBalance(entity)).toBe(100_000);
        }, 120_000);

    it('takes a 0x0010 item without an OnPurchase straight back off the '
        + 'ship, so its Max of 1 never blocks a repeat purchase', async () => {
            const gameData = await getSyntheticGameData();
            const entity = await dockedSkiff(1_000);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;
            const shown = outfitter.show(entity);
            await untilShown(outfitter);

            const voucher = await gameData.data.Outfit.get(DOCK_VOUCHER);
            expect(voucher.removeAfterPurchase).toBe(true);
            expect(voucher.max).toBe(1);
            (outfitter as any).applyBuy(voucher);
            (outfitter as any).applyBuy(voucher);
            const working: Map<string, number> = (outfitter as any).outfits;
            expect(working.has(DOCK_VOUCHER)).toBe(false);
            const context: OutfitterContext = (outfitter as any).makeContext();
            expect(ownedCount(DOCK_VOUCHER, context)).toBe(0);
            // No outfitter ever puts the Dock Voucher on a shelf (BuyRandom
            // 0), so the shop refuses it for THAT reason and never for its
            // Max.
            const check = canBuyOutfit(voucher,
                { ...context, credits: Infinity });
            expect(check.allowed ? '' : check.reason).toBe('notStocked');
            expect(check.allowed ? '' : check.reason).not.toBe('maxCount');

            outfitter.dismiss();
            const departed = await shown;
            expect(departed.components.get(OutfitsStateComponent)!
                .has(DOCK_VOUCHER)).toBe(false);
        }, 120_000);

    it('keeps its working outfit copy to the outfits actually owned after '
        + 'a grid refresh', async () => {
            // The working copy is a DefaultMap; the rules used to be
            // handed it directly, and visibleOutfits' get() on every
            // outfit in the game inserted every id at count 0.
            const gameData = await getSyntheticGameData();
            const entity = await dockedSkiff(1_000);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;
            const shown = outfitter.show(entity);
            await untilShown(outfitter);
            (outfitter as any).refreshGrid();
            (outfitter as any).refreshTradeState();
            const owned = [PULSE_BLASTER, SHIELD_CAPACITOR];
            const working: Map<string, number> = (outfitter as any).outfits;
            expect([...working.keys()]).toEqual(owned);
            const context: OutfitterContext = (outfitter as any).makeContext();
            expect([...context.outfits.keys()]).toEqual(owned);
            outfitter.dismiss();
            await shown;
        }, 120_000);

    it('charges a unit a build order\'s Dxxx consumes against THIS visit\'s '
        + 'receipt, so the pre-owned unit sells back at resale, not at cost',
        async () => {
            // The pilot owns one Pulse Blaster, buys a second (a same-visit
            // receipt: selling it back would refund 100%), then buys a
            // build order in the BYOM:455 "Dismantle" mould — a 0x0010
            // permit whose OnPurchase is `D128`, one Pulse Blaster gone.
            // One blaster is left aboard and one was paid for this visit;
            // the unit the order dismantled spends that receipt. Otherwise
            // the survivor — the pre-owned one — sells at the full price
            // the consumed one was bought for, and the player is 75% of a
            // blaster ahead for having dismantled it.
            const gameData = await getSyntheticGameData();
            const entity = await dockedSkiff(100_000);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;
            const shown = outfitter.show(entity);
            await untilShown(outfitter);

            const blaster = await gameData.data.Outfit.get(PULSE_BLASTER);
            const ship = (outfitter as any).shipData;
            // The Dock Voucher with a build order bolted on. It keeps the
            // voucher's own id so the shop can still look the outfit up
            // (the synthetic parser reports a missing id rather than
            // swallowing it, and an invented one is not in the scenario).
            const dismantle = {
                ...await gameData.data.Outfit.get(DOCK_VOUCHER),
                name: 'Dismantle Pulse Blaster',
                price: 0, onPurchase: 'D128',
            };
            expect(dismantle.removeAfterPurchase).toBe(true);
            // (Re-read the working copy after each buy: an OnPurchase that
            // runs through the mission session replaces the map.)
            const working = (): Map<string, number> => (outfitter as any).outfits;
            (outfitter as any).applyBuy(blaster);
            expect(working().get(PULSE_BLASTER)).toBe(2);
            (outfitter as any).applyBuy(dismantle);
            expect(working().get(PULSE_BLASTER)).toBe(1);
            expect(working().has(dismantle.id)).toBe(false);
            const receipts: Map<string, number> =
                (outfitter as any).visitPurchases;
            expect(receipts.get(PULSE_BLASTER) ?? 0).toBe(0);

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
