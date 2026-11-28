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
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import {
    CargoComponent, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { resetOfferRolls } from './mission_offers.js';
import { Outfitter } from './outfitter.js';
import { Spaceport } from './spaceport.js';

/**
 * ============================================================================
 * "CLEAR LEGAL RECORD" PRESSED WHILE DOCKED
 * ============================================================================
 *
 * The status bar's debug buttons are control edges the simulation applies
 * to the player's ship (DebugCheatSystem). Docked, the ship is out of the
 * simulation, so the edge found nobody: "Give 1M Credits" was lost (fixed
 * with docked_credit_grant_test.ts), and so was "Clear Legal Record".
 * Docked, the clear now empties the landing's working copy and the hull
 * (DockedShip.clearLegalRecords → LandedTransaction.clearLegalRecords),
 * lifts off with the hull, and no venue's rollback brings the old records
 * back. ("Add Enemy" is not affected: it spawns an NPC into the system,
 * not onto the player.) Drives the real Spaceport and outfitter.
 */
describe('Clear Legal Record while docked', () => {
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
            .addComponent(LegalRecordsComponent,
                new Map([['nova:300', -500], ['nova:301', 40]]))
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

    interface TransactionView {
        state: { records?: Map<string, number> };
        savepoint(label?: string): unknown;
        rollback(savepoint: unknown): void;
    }

    it('empties the working copy and the hull, and lifts off clean', async () => {
        const { docked, leave, entity } = await shop();
        expect(docked.component(LegalRecordsComponent)?.size).toBe(2);
        docked.clearLegalRecords();
        expect(docked.component(LegalRecordsComponent)?.size).toBe(0);
        expect(entity.components.get(LegalRecordsComponent)?.size).toBe(0);
        await leave();
        expect(entity.components.get(LegalRecordsComponent)?.size).toBe(0);
    });

    it('is not undone by rolling back a savepoint taken before it', async () => {
        const { docked, leave, entity } = await shop();
        const transaction =
            docked.transaction as unknown as TransactionView;
        const before = transaction.savepoint('before the clear');
        transaction.state.records!.set('nova:302', -20);
        docked.clearLegalRecords();
        // A record the venue made AFTER the clear is still its own to undo.
        transaction.state.records!.set('nova:303', 15);
        transaction.rollback(before);
        expect([...docked.component(LegalRecordsComponent)!]).toEqual([]);
        await leave();
        expect(entity.components.get(LegalRecordsComponent)?.size).toBe(0);
    });

    it('clears the hull directly when no landing transaction is attached', () => {
        const entity = pilot();
        const docked = new DockedShip(entity, () => { });
        docked.clearLegalRecords();
        expect(entity.components.get(LegalRecordsComponent)?.size).toBe(0);
    });
});
