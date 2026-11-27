import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultSpriteSheetData } from 'novadatainterface/sprite_sheet_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { DockedShip } from '../display/docked_ship.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { ActiveRanksComponent, ControlBitsComponent }
    from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import {
    CargoComponent, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { creditBalance } from './credit_commit.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { resetOfferRolls } from './mission_offers.js';
import { Outfitter } from './outfitter.js';
import { Spaceport } from './spaceport.js';

/**
 * ============================================================================
 * SELF-GRANTING OUTFITS: the original's four steps, pinned
 * ============================================================================
 *
 * Reference "A self-granting outfit (the hub's item 2), wave 51": a
 * plug-in's oütf whose OnPurchase grants ITSELF (`G<self>`) or whose
 * OnSell deletes itself (`D<self>`). On the original:
 *
 *   1. one Buy of a `G<self>` outfit gives TWO for one price, and the `G`
 *      ignores Max: at Max 3 holding 2, a Buy gives FOUR (kept across the
 *      Leave);
 *   2. the Buy gate is the count before the purchase: live at 2 of Max 3,
 *      greyed with "Can't have any more!" at 3 or 4 (and still greyed once
 *      the 4th is sold back to 3);
 *   3. an OnSell `D<self>` sale removes TWO for ONE refund: full price for
 *      units bought this visit, half (the resale value) for pre-owned
 *      ones, alone and with a `G<self>` OnPurchase;
 *   4. a `G<other>` OnPurchase grants that other outfit.
 *
 * NovaJS matched all four by reading (Outfitter.applyBuy / applySell and
 * the NCB G / D hooks); these drive the REAL outfitter (headless PIXI)
 * through its Buy / Sell buttons' own paths (buyOutfit / sellOutfit on the
 * grid's selection, the gate and the caption included), on synthetic
 * mock data that mirrors the wave's Kit Self Grant rig: oütf 514-518, each
 * Max 3 and 1,000 cr (massless here; the rig's +1 t of cargo only fed its
 * HUD's Free count), at a port that sells them all, the pilot with
 * 1,000,000 cr. Runs `sg_a` (nothing held) and `sg_b` (two of each of 514
 * / 515 / 516 pre-owned).
 */
describe('self-granting outfits (reference SG, wave 51)', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => {
        resetOfferRolls();
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    const PLANET_ID = 'nova:1215';
    const SHIP_ID = 'nova:701';
    const [GRANT, DROP, BOTH, GIVER, GIFT] =
        [514, 515, 516, 517, 518].map(id => `nova:${id}`);
    const PRICE = 1_000;
    const START_CREDITS = 1_000_000;

    function outfit(id: string, name: string,
        strings: Partial<Pick<OutfitData, 'onPurchase' | 'onSell'>>):
        OutfitData {
        return {
            ...getDefaultOutfitData(), id, name, pict: '', price: PRICE,
            max: 3, buyRandom: 100, ...strings,
        };
    }

    const OUTFITS = new Map<string, OutfitData>([
        [GRANT, outfit(GRANT, 'Kit SG Grant', { onPurchase: 'G514' })],
        [DROP, outfit(DROP, 'Kit SG Drop', { onSell: 'D515' })],
        [BOTH, outfit(BOTH, 'Kit SG Both',
            { onPurchase: 'G516', onSell: 'D516' })],
        [GIVER, outfit(GIVER, 'Kit SG Giver', { onPurchase: 'G518' })],
        [GIFT, outfit(GIFT, 'Kit SG Gift', {})],
    ]);

    function gameData(): SimulationGameDataInterface {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET_ID, {
            ...getDefaultPlanetData(), id: PLANET_ID, name: 'Kit Self Grant',
            landingPict: '', landingDesc: '',
            flags: {
                ...getDefaultPlanetData().flags,
                hasShipyard: false, hasOutfitter: true, hasBar: false,
                hasCommodityExchange: false,
            },
        } as PlanetData);
        const hull: ShipData = {
            ...getDefaultShipData(), id: SHIP_ID, name: 'Kit Probe A',
            price: 100_000, pict: '',
            physics: {
                ...getDefaultShipData().physics, freeMass: 50, freeCargo: 50,
            },
        };
        data.data.Ship.map.set(SHIP_ID, hull);
        for (const [id, item] of OUTFITS) {
            data.data.Outfit.map.set(id, item);
        }
        data.data.SpriteSheet.map.set('nova:0', getDefaultSpriteSheetData());
        return data as unknown as SimulationGameDataInterface;
    }

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: { Sound: { get: async () => undefined } },
        } as unknown as DisplayAssetDataInterface;
    }

    function pilot(held: Map<string, number>): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: SHIP_ID })
            .addComponent(MultiplayerData, { owner: 'peer-1' })
            .addComponent(CreditsComponent, { credits: START_CREDITS })
            .addComponent(OutfitsStateComponent, new Map(
                [...held].map(([id, count]) => [id, { count }])))
            .addComponent(CargoComponent, new Map())
            .addComponent(MissionsComponent, new Map())
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(ActiveRanksComponent, new Set<string>())
            .addComponent(GameDateComponent, { day: 1, month: 1, year: 1177 });
    }

    async function settle() {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    async function waitFor(ready: () => boolean, what = 'ready') {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).withContext(what).toBe(true);
    }

    /** The outfitter's privates these specs drive (the Buy / Sell
     * buttons' own handlers and what they show). */
    interface OutfitterView {
        shipData?: ShipData;
        /** ItemGrid's selection and (private) stocked items. */
        itemGrid?: { selection?: OutfitData, items: OutfitData[] };
        buyOutfit(): void;
        sellOutfit(): void;
        buttons: { buy: { state: string }, sell: { state: string } };
        text: { status: PIXI.Text };
        outfits: Map<string, number>;
        credits: { credits: number };
    }

    /**
     * Lands at the Kit Self Grant port holding `held`, and opens the
     * outfitter. Returns the shop (select / buy / sell through the grid
     * and the buttons' handlers) and the Leave.
     */
    async function shop(held = new Map<string, number>()) {
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(displayAssets(), gameData(),
            PLANET_ID, controlEvents);
        await spaceport.buildPromise;
        const entity = pilot(held);
        const dockedShip = new DockedShip(entity, () => { });
        spaceport.setDockedShip(dockedShip);
        const departed = spaceport.show(entity);
        await waitFor(() => spaceport.onMainScreen, 'the spaceport opened');
        const press = async (action: ControlEvent['action']) => {
            controlEvents.next({ action, state: 'start' });
            await settle();
        };
        await press('outfitter');
        await waitFor(() => !spaceport.onMainScreen, 'the outfitter opened');
        const view = (spaceport as unknown as { outfitter: Outfitter })
            .outfitter as unknown as OutfitterView;
        await waitFor(() => view.shipData !== undefined
            && (view.itemGrid?.items.length ?? 0) === OUTFITS.size,
            'the outfitter stocked the five');

        const select = (id: string) => {
            const grid = view.itemGrid!;
            grid.selection = grid.items.find(item => item.id === id)!;
            expect(grid.selection?.id).toBe(id);
        };
        const buy = (id: string) => {
            select(id);
            view.buyOutfit();
        };
        const sell = (id: string) => {
            select(id);
            view.sellOutfit();
        };
        /** The Buy button as the player sees it with `id` selected. */
        const buyButton = (id: string) => {
            select(id);
            (view as unknown as { refreshTradeState(): void })
                .refreshTradeState();
            return { state: view.buttons.buy.state,
                caption: view.text.status.text };
        };
        const count = (id: string) => view.outfits.get(id) ?? 0;
        const credits = () => view.credits.credits;
        const leave = async () => {
            await press('depart');
            await waitFor(() => spaceport.onMainScreen, 'back on the main screen');
            await press('depart');
            return departed;
        };
        return { buy, sell, buyButton, count, credits, leave, entity };
    }

    const heldOn = (entity: Entity, id: string) =>
        entity.components.get(OutfitsStateComponent)!.get(id)?.count ?? 0;

    it('sg_a: G<self> gives two for one price, then four past Max 3, then '
        + 'greys the Buy; D<self> takes two for one full refund; G<other> '
        + 'grants the other', async () => {
            const { buy, sell, buyButton, count, credits, leave, entity } =
                await shop();

            // Grant, from 0: two units, one price, Buy still live.
            buy(GRANT);
            expect(count(GRANT)).toBe(2);
            expect(credits()).toBe(999_000);
            expect(buyButton(GRANT).state).toBe('normal');
            // Holding 2 of Max 3: the gate passes, and the G adds a 4th.
            buy(GRANT);
            expect(count(GRANT)).toBe(4);
            expect(credits()).toBe(998_000);
            expect(buyButton(GRANT))
                .toEqual({ state: 'grey', caption: "Can't have any more!" });
            // A click on the greyed Buy does nothing.
            buy(GRANT);
            expect(count(GRANT)).toBe(4);
            expect(credits()).toBe(998_000);
            // Selling the 4th refunds one full price (bought this visit)
            // and leaves 3 = Max: still greyed.
            sell(GRANT);
            expect(count(GRANT)).toBe(3);
            expect(credits()).toBe(999_000);
            expect(buyButton(GRANT))
                .toEqual({ state: 'grey', caption: "Can't have any more!" });

            // Giver: its G518 grants a Gift.
            buy(GIVER);
            expect(count(GIVER)).toBe(1);
            expect(count(GIFT)).toBe(1);
            expect(credits()).toBe(998_000);

            // Drop: two Buys, then one Sell takes both for one refund.
            buy(DROP);
            buy(DROP);
            expect(count(DROP)).toBe(2);
            expect(credits()).toBe(996_000);
            sell(DROP);
            expect(count(DROP)).toBe(0);
            expect(credits()).toBe(997_000);

            // Both: one Buy gives two, one Sell takes both, one refund.
            buy(BOTH);
            expect(count(BOTH)).toBe(2);
            expect(credits()).toBe(996_000);
            sell(BOTH);
            expect(count(BOTH)).toBe(0);
            expect(credits()).toBe(997_000);

            // The pilot written at the Leave.
            const lifted = await leave();
            expect(lifted).toBe(entity);
            expect(heldOn(entity, GRANT)).toBe(3);
            expect(heldOn(entity, GIVER)).toBe(1);
            expect(heldOn(entity, GIFT)).toBe(1);
            expect(heldOn(entity, DROP)).toBe(0);
            expect(heldOn(entity, BOTH)).toBe(0);
            expect(creditBalance(entity)).toBe(997_000);
        });

    it('sg_b: from two pre-owned, a G<self> Buy gives four (kept past the '
        + 'Leave); a D<self> Sell takes both for ONE half-price refund',
        async () => {
            const { buy, sell, buyButton, count, credits, leave, entity } =
                await shop(new Map([[GRANT, 2], [DROP, 2], [BOTH, 2]]));

            expect(buyButton(GRANT).state).toBe('normal');
            buy(GRANT);
            expect(count(GRANT)).toBe(4);
            expect(credits()).toBe(999_000);
            expect(buyButton(GRANT))
                .toEqual({ state: 'grey', caption: "Can't have any more!" });

            sell(DROP);
            expect(count(DROP)).toBe(0);
            expect(credits()).toBe(999_500);

            sell(BOTH);
            expect(count(BOTH)).toBe(0);
            expect(credits()).toBe(1_000_000);

            await leave();
            expect(heldOn(entity, GRANT)).toBe(4);
            expect(heldOn(entity, DROP)).toBe(0);
            expect(heldOn(entity, BOTH)).toBe(0);
            expect(creditBalance(entity)).toBe(1_000_000);
        });
});
