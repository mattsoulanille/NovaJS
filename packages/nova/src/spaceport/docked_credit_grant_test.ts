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
import { DEBUG_CREDITS_GRANT } from '../nova_plugin/pilot/index.js';
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
 * MONEY THAT ARRIVES WHILE DOCKED, AND EVERY READOUT OF IT
 * ============================================================================
 *
 * Matthew's 2026-11-27 playtest: the status bar said "Credits: 1.09M", the
 * outfitter's info pane "You Have: 1.925M cr", and a 1.5M item was refused
 * with "Can't afford this item!". The bar and the gate were right (1,092,5xx
 * credits); the pane misprinted the balance (format_price.ts dropped the
 * fraction's leading zero — format_price_test.ts). Reproducing it headless
 * showed a second fault on the same road: the status bar's "Give 1M
 * Credits" pressed while LANDED was a control edge sent to a simulation
 * the docked ship is not in, so it found nobody and was silently lost.
 *
 * Docked, the grant now goes into the landing's ledger
 * (DockedShip.applyExternalCredits → LandedTransaction.applyExternalCredits)
 * and the Spaceport tells the open venue (onCreditsChanged), so the pane,
 * the Buy gate, the status bar's working-copy readout and the balance that
 * lifts off all move together. These drive the REAL Spaceport and
 * outfitter (headless PIXI) on mock data mirroring the playtest: a 1.5M
 * outfit and a pilot holding 92,513 credits.
 */
describe('a credit grant while docked', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => {
        resetOfferRolls();
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    const PLANET_ID = 'nova:1215';
    const SHIP_ID = 'nova:701';
    const ITEM = 'nova:514';
    const PRICE = 1_500_000;
    const START = 92_513;

    function gameData(): SimulationGameDataInterface {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET_ID, {
            ...getDefaultPlanetData(), id: PLANET_ID, name: 'Kit Grant Port',
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
        const item: OutfitData = {
            ...getDefaultOutfitData(), id: ITEM,
            name: 'Kit Repairing System', pict: '', price: PRICE, max: 1,
            buyRandom: 100,
        };
        data.data.Outfit.map.set(ITEM, item);
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

    function pilot(): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: SHIP_ID })
            .addComponent(MultiplayerData, { owner: 'peer-1' })
            .addComponent(CreditsComponent, { credits: START })
            .addComponent(OutfitsStateComponent, new Map())
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

    interface OutfitterView {
        shipData?: ShipData;
        itemGrid?: { selection?: OutfitData, items: OutfitData[] };
        buyOutfit(): void;
        buttons: { buy: { state: string } };
        text: { status: PIXI.Text, count: PIXI.Text };
        credits: { credits: number };
    }

    /** Lands, opens the outfitter, selects the 1.5M item. */
    async function shop() {
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(displayAssets(), gameData(),
            PLANET_ID, controlEvents);
        await spaceport.buildPromise;
        const entity = pilot();
        const docked = new DockedShip(entity, () => { });
        spaceport.setDockedShip(docked);
        const departed = spaceport.show(entity);
        await waitFor(() => spaceport.onMainScreen, 'the spaceport opened');
        await waitFor(() => docked.transaction !== undefined,
            'the landing opened its transaction');
        const press = async (action: ControlEvent['action']) => {
            controlEvents.next({ action, state: 'start' });
            await settle();
        };
        await press('outfitter');
        await waitFor(() => !spaceport.onMainScreen, 'the outfitter opened');
        const view = (spaceport as unknown as { outfitter: Outfitter })
            .outfitter as unknown as OutfitterView;
        await waitFor(() => view.shipData !== undefined
            && (view.itemGrid?.items.length ?? 0) === 1, 'stocked');
        const grid = view.itemGrid!;
        grid.selection = grid.items[0];
        (view as unknown as { refreshTradeState(): void }).refreshTradeState();
        /** What the player sees, read WITHOUT poking any refresh. */
        const pane = () => ({
            youHave: view.text.count.text,
            buy: view.buttons.buy.state,
            caption: view.text.status.text,
        });
        const leave = async () => {
            await press('depart');
            await waitFor(() => spaceport.onMainScreen, 'back on the main screen');
            await press('depart');
            return departed;
        };
        return { docked, view, pane, leave, entity };
    }

    it('reaches the open outfitter\'s pane, gate and the status bar at once', async () => {
        const { docked, view, pane, leave, entity } = await shop();
        expect(pane()).toEqual({ youHave: '92,513 cr', buy: 'grey',
            caption: 'Can\'t afford this item!' });

        docked.applyExternalCredits(DEBUG_CREDITS_GRANT);
        // The playtest's balance: 1.09M on the bar, 1.092M in the pane
        // (not 1.925M), and the 1.5M item still honestly unaffordable.
        expect(pane()).toEqual({ youHave: '1.092M cr', buy: 'grey',
            caption: 'Can\'t afford this item!' });
        expect(docked.component(CreditsComponent)?.credits)
            .toBe(START + DEBUG_CREDITS_GRANT);

        docked.applyExternalCredits(DEBUG_CREDITS_GRANT);
        expect(pane()).toEqual({ youHave: '2.092M cr', buy: 'normal',
            caption: '' });

        view.buyOutfit();
        expect(view.credits.credits).toBe(START + 2 * DEBUG_CREDITS_GRANT - PRICE);
        expect(pane().youHave).toBe('592,513 cr');

        await leave();
        // Both grants and the purchase lift off on the hull.
        expect(creditBalance(entity))
            .toBe(START + 2 * DEBUG_CREDITS_GRANT - PRICE);
        expect(entity.components.get(OutfitsStateComponent)!.get(ITEM))
            .toEqual({ count: 1 });
    });

    it('tells onCreditsChanged listeners, until they unsubscribe', async () => {
        const { docked, leave, entity } = await shop();
        const transaction = docked.transaction!;
        let told = 0;
        const stop = transaction.onCreditsChanged(() => told++);
        docked.applyExternalCredits(DEBUG_CREDITS_GRANT);
        expect(told).toBe(1);
        stop();
        docked.applyExternalCredits(DEBUG_CREDITS_GRANT);
        expect(told).toBe(1);
        // Nothing is spent in the outfitter: Done lands both grants.
        await leave();
        expect(creditBalance(entity)).toBe(START + 2 * DEBUG_CREDITS_GRANT);
    });

    it('writes the hull directly when no landing transaction is attached', () => {
        // The landing gap before the transaction opens, or a hypergate dock.
        const entity = pilot();
        const docked = new DockedShip(entity, () => { });
        docked.applyExternalCredits(DEBUG_CREDITS_GRANT);
        expect(creditBalance(entity)).toBe(START + DEBUG_CREDITS_GRANT);
        expect(docked.component(CreditsComponent)?.credits)
            .toBe(START + DEBUG_CREDITS_GRANT);
    });
});
