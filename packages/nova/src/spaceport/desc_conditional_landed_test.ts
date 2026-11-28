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
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { resetOfferRolls } from './mission_offers.js';
import { Outfitter } from './outfitter.js';
import { Spaceport } from './spaceport.js';

/**
 * dësc conditionals where the player reads them while landed, against the
 * reference "dësc test operators, wave 54" (the expander itself is pinned
 * in nova_plugin/ncb/desc_text_test.ts):
 *
 * - the OUTFITTER description of Extra Outfits' Inertial Damper (dësc
 *   3319), whose `{o609 ...}` block NovaJS used to print raw (Matthew's
 *   screenshot, 2026-11-27): the original has no outfit term in a dësc, so
 *   the block takes its test from the g of "get" and a male pilot sees the
 *   text up to "License" and one space — whether or not the ship holds
 *   outfit 609;
 * - the LANDING description, which the original expands against the
 *   player's real control bits (wave 54's landing-text bit test); NovaJS
 *   used to expand it once, at build, with every bit clear.
 *
 * Headless PIXI, the real Spaceport and Outfitter, synthetic mock data.
 */
describe('dësc conditionals in the landed screens (reference wave 54)', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => {
        resetOfferRolls();
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    const PLANET_ID = 'nova:1216';
    const SHIP_ID = 'nova:701';
    const DAMPER = 'nova:609';
    const DAMPER_DESC = 'This outfit will totally override your engines.\r\r'
        + 'Requires: Exotic Technologies License{o609 "\r\rYou can`t get this '
        + 'outfit since your ship is already inertialess." ""}';
    const LANDING_DESC = 'A port. L[{b9351 "Y" "N"}]';

    function gameData(): SimulationGameDataInterface {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET_ID, {
            ...getDefaultPlanetData(), id: PLANET_ID, name: 'Kit Desc Port',
            landingPict: '', landingDesc: LANDING_DESC,
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
        const damper: OutfitData = {
            ...getDefaultOutfitData(), id: DAMPER, name: 'Inertial Damper',
            pict: '', price: 750_000, max: 1, buyRandom: 100, desc: DAMPER_DESC,
        };
        data.data.Outfit.map.set(DAMPER, damper);
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

    function pilot(bits: number[], held: Map<string, number>): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: SHIP_ID })
            .addComponent(MultiplayerData, { owner: 'peer-1' })
            .addComponent(CreditsComponent, { credits: 1_000_000 })
            .addComponent(OutfitsStateComponent, new Map(
                [...held].map(([id, count]) => [id, { count }])))
            .addComponent(CargoComponent, new Map())
            .addComponent(MissionsComponent, new Map())
            .addComponent(ControlBitsComponent, new Set<number>(bits))
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
        text: { description: PIXI.Text };
    }

    /** Lands `entity` at the port; returns the spaceport and its controls. */
    async function land(spaceport: Spaceport, controlEvents: Subject<ControlEvent>,
        entity: Entity) {
        spaceport.setDockedShip(new DockedShip(entity, () => { }));
        void spaceport.show(entity);
        await waitFor(() => spaceport.onMainScreen, 'the spaceport opened');
        const press = async (action: ControlEvent['action']) => {
            controlEvents.next({ action, state: 'start' });
            await settle();
        };
        return press;
    }

    /** The landing description's text on screen. */
    function landingText(spaceport: Spaceport): string {
        return (spaceport as unknown as { landingDesc: PIXI.Text })
            .landingDesc.text;
    }

    async function damperDescription(held: Map<string, number>) {
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(displayAssets(), gameData(),
            PLANET_ID, controlEvents);
        await spaceport.buildPromise;
        const press = await land(spaceport, controlEvents, pilot([], held));
        await press('outfitter');
        await waitFor(() => !spaceport.onMainScreen, 'the outfitter opened');
        const view = (spaceport as unknown as { outfitter: Outfitter })
            .outfitter as unknown as OutfitterView;
        await waitFor(() => view.shipData !== undefined
            && (view.itemGrid?.items.length ?? 0) === 1,
            'the outfitter stocked the damper');
        const grid = view.itemGrid!;
        grid.selection = grid.items.find(item => item.id === DAMPER)!;
        await settle();
        return view.text.description.text;
    }

    it('shows the Inertial Damper text up to "License " (no raw block), '
        + 'with or without outfit 609', async () => {
        const expected = 'This outfit will totally override your engines.\r\r'
            + 'Requires: Exotic Technologies License ';
        expect(await damperDescription(new Map())).toBe(expected);
        expect(await damperDescription(new Map([[DAMPER, 1]]))).toBe(expected);
    });

    it('expands the landing text against the landing\'s control bits, '
        + 'again on every landing', async () => {
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(displayAssets(), gameData(),
            PLANET_ID, controlEvents);
        await spaceport.buildPromise;
        // Built, never landed: no bits yet.
        expect(landingText(spaceport)).toBe('A port. L[N]');

        const press = await land(spaceport, controlEvents,
            pilot([9351], new Map()));
        expect(landingText(spaceport)).toBe('A port. L[Y]');
        await press('depart');

        // The same (cached) spaceport, a pilot without the bit.
        await land(spaceport, controlEvents, pilot([], new Map()));
        expect(landingText(spaceport)).toBe('A port. L[N]');
    });
});
