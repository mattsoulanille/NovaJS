import 'jasmine';
import { getDefaultMissionData } from 'novadatainterface/mission_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { CargoComponent } from '../nova_plugin/ship/cargo_plugin.js';
import { ControlEvent } from '../nova_plugin/core/controls_plugin.js';
import { LOCATION_MAIN_SPACEPORT } from '../nova_plugin/missions/mission_logic.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/player_state_plugin.js';
import { ShipComponent } from '../nova_plugin/ship/ship_plugin.js';
import { Button } from './button.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { OfferPopup } from './offer_popup.js';
import { Spaceport } from './spaceport.js';

/**
 * ============================================================================
 * THE LANDING POPUPS ARE MODAL FOR THE POINTER, AND LEAVING UNDER ONE
 * DOES NOT KEEP THE SPACEPORT'S KEYS
 * ============================================================================
 *
 * Review finding #28. Spaceport.show() reveals the spaceport and THEN
 * runs the landing popup sequence (mission completion texts, then the
 * AvailLoc 3 offers) over it. OfferPopup made only its frame sprites
 * interactive, so — unlike every other dialog, which puts a full-screen
 * invisible interactive shield under itself — anything the frame did not
 * cover stayed clickable. Geometry: the tallest tiled popup spans y
 * -158..158 and the Leave pill sits at y 198..223, so Leave was exposed
 * under EVERY landing popup.
 *
 * Clicking it fired Menu.done(): super.show() resolved (hiding the
 * spaceport and unbinding its controls) while the popup loop kept
 * running blind, and when that loop ended its `finally` rebound the
 * spaceport's MenuControls unconditionally. Nothing ever unbound them
 * again — browser.ts routes every keydown to MenuControls.focused, so the
 * player lifted off into a ship they could not fly, hail, or Escape from.
 *
 * Two fixes, each pinned here: the popup carries the same shield as the
 * other dialogs, and the spaceport only ever rebinds its controls while
 * it is still on screen (the venue handlers get the same guard).
 */
describe('a landing popup over the spaceport', () => {
    beforeAll(() => installHeadlessPixi());

    const PLANET_ID = 'nova:128';
    const SHIP_ID = 'nova:128';
    const MISSION_ID = 'nova:500';

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

    /**
     * One stellar with no venues at all (so only Leave is on screen) and
     * one always-available main-spaceport (AvailLoc 3) offer with text, so
     * the landing sequence raises exactly one popup.
     */
    function gameData(): MockGameData {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET_ID, {
            ...getDefaultPlanetData(), id: PLANET_ID, name: 'Earth',
            landingPict: '', landingDesc: '',
            flags: {
                ...getDefaultPlanetData().flags,
                hasShipyard: false, hasOutfitter: false, hasBar: false,
                hasCommodityExchange: false,
            },
        });
        data.data.Ship.map.set(SHIP_ID, {
            ...getDefaultShipData(), id: SHIP_ID, pict: '',
        });
        data.data.Mission.map.set(MISSION_ID, {
            ...getDefaultMissionData(), id: MISSION_ID,
            availLoc: LOCATION_MAIN_SPACEPORT, availRandom: 100,
            offerText: 'A courier is needed.', acceptButton: 'Sure',
            refuseButton: 'No thanks',
        });
        return data;
    }

    function landedPilot(): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: SHIP_ID })
            .addComponent(CreditsComponent, { credits: 1000 })
            .addComponent(OutfitsStateComponent, new Map())
            .addComponent(CargoComponent, new Map())
            .addComponent(MissionsComponent, new Map())
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(GameDateComponent, { day: 1, month: 1, year: 1177 });
    }

    /** Spins the event loop until `ready` holds (or the spec gives up). */
    async function waitFor(ready: () => boolean) {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).toBe(true);
    }

    /** The spaceport's private landing popup, keys, BBS and Leave button. */
    function internals(spaceport: Spaceport) {
        return spaceport as unknown as {
            offerPopup: OfferPopup,
            controls: MenuControls,
            missionComputer: { container: PIXI.Container },
            buttons: { leave: Button },
        };
    }

    /** Lands, and resolves once the offer popup is up over the spaceport. */
    async function landUnderPopup() {
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(displayAssets(),
            gameData() as unknown as SimulationGameDataInterface, PLANET_ID,
            controlEvents);
        await spaceport.buildPromise;
        const entity = landedPilot();
        const departed = spaceport.show(entity);
        const { offerPopup, buttons } = internals(spaceport);
        await waitFor(() => offerPopup.container.visible);
        expect(spaceport.container.visible).toBeTrue();
        // The popup holds the keyboard, not the spaceport.
        expect(MenuControls.focused).toBeDefined();
        expect(spaceport.onMainScreen).toBeFalse();
        return { spaceport, controlEvents, entity, departed, offerPopup, buttons };
    }

    afterEach(() => {
        // Whatever a spec did, nothing may be left holding the keyboard.
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    it('shields the venue buttons: an invisible interactive rectangle '
        + 'under the frame covers the Leave pill', async () => {
            const { spaceport, offerPopup, buttons, controlEvents, departed } =
                await landUnderPopup();
            const first = offerPopup.container.getChildAt(0);
            expect(first).toBeInstanceOf(PIXI.Graphics);
            expect(first.interactive).toBeTrue();
            // The popup and the buttons share the spaceport's coordinate
            // space; the pill is 120px wide (plus caps) and 25px tall.
            const leave = buttons.leave.container.position;
            const bounds = (first as PIXI.Graphics).getLocalBounds();
            for (const [dx, dy] of [[0, 0], [120, 0], [0, 25], [120, 25]]) {
                expect(bounds.contains(leave.x + dx, leave.y + dy))
                    .withContext(`Leave corner (${dx}, ${dy})`).toBeTrue();
            }
            // Refuse the offer (a two-button offer ignores Escape), then
            // leave normally: the spaceport takes its keys back first.
            (offerPopup as unknown as {
                choice: Subject<'accept' | 'refuse'>,
            }).choice.next('refuse');
            await waitFor(() => !offerPopup.container.visible);
            await waitFor(() => spaceport.onMainScreen);
            controlEvents.next({ action: 'depart', state: 'start' });
            await departed;
            expect(MenuControls.focused).toBeUndefined();
        });

    it('does not leave the spaceport\'s controls bound when Leave fires '
        + 'while a popup is still up', async () => {
            const { spaceport, offerPopup, buttons, departed } =
                await landUnderPopup();
            // The pre-shield hazard, driven directly: Leave under the
            // popup. Menu.show() resolves at once; the popup sequence is
            // still running.
            buttons.leave.click.next({ shift: false, option: false });
            await waitFor(() => !spaceport.container.visible);
            // The popup is still up, hidden with its parent; the sequence
            // is running blind (show() resolves only once it ends).
            expect(offerPopup.container.visible).toBeTrue();
            // The player works through the blind popup: accept the offer.
            (offerPopup as unknown as {
                choice: Subject<'accept' | 'refuse'>,
            }).choice.next('accept');
            await waitFor(() => !offerPopup.container.visible);
            expect(await departed).toBeDefined();
            // The sequence's exit must NOT hand the keyboard to a spaceport
            // that has already been left.
            expect(MenuControls.focused).toBeUndefined();
            expect(spaceport.onMainScreen).toBeFalse();
        });

    /**
     * Spaceport.show() binds its keys BEFORE the landing processing (so
     * 'p'/'i' work while the mission universe loads) and only reveals the
     * frame afterwards. A venue key in that gap used to open the venue
     * invisibly over the landing processing; enterVenue() now refuses
     * while the spaceport is not on screen, and keeps the keys.
     */
    it('ignores a venue key during the landing gap, before the spaceport '
        + 'is on screen', async () => {
            const controlEvents = new Subject<ControlEvent>();
            const spaceport = new Spaceport(displayAssets(),
                gameData() as unknown as SimulationGameDataInterface,
                PLANET_ID, controlEvents);
            await spaceport.buildPromise;
            const departed = spaceport.show(landedPilot());
            const { controls, missionComputer, offerPopup } =
                internals(spaceport);
            // The gap: keys owned, frame not yet revealed.
            expect(spaceport.container.visible).toBeFalse();
            expect(MenuControls.focused).toBe(controls);
            controlEvents.next({ action: 'missionBBS', state: 'start' });
            // Refused: the venue did not take the keys, nothing opened.
            expect(MenuControls.focused).toBe(controls);
            expect(missionComputer.container.visible).toBeFalse();
            await waitFor(() => offerPopup.container.visible);
            expect(spaceport.container.visible).toBeTrue();
            expect(missionComputer.container.visible).toBeFalse();
            (offerPopup as unknown as {
                choice: Subject<'accept' | 'refuse'>,
            }).choice.next('refuse');
            await waitFor(() => spaceport.onMainScreen);
            controlEvents.next({ action: 'depart', state: 'start' });
            await departed;
            expect(MenuControls.focused).toBeUndefined();
        });
});
