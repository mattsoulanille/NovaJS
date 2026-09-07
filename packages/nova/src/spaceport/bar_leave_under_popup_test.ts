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
import { CargoComponent, OutfitsStateComponent, ShipComponent } from '../nova_plugin/ship/index.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { LOCATION_BAR } from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { Bar } from './bar.js';
import { Button } from './button.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * ============================================================================
 * LEAVING THE BAR UNDER AN OFFER POPUP OR A SUB-DIALOG DOES NOT KEEP ITS KEYS
 * ============================================================================
 *
 * Review finding #28, the bar half. Bar.show() reveals the bar and THEN
 * runs the entry offer popups over it; the news/gamble/hire dialogs open
 * over it later. Leave (Menu.done) resolves super.show() at once — hiding
 * the bar and unbinding its MenuControls — while the sequence keeps
 * running, and when it ended it rebound the bar's keys unconditionally.
 * Nothing unbinds them again: browser.ts routes every keydown to
 * MenuControls.focused, so the player lifted off into a ship they could
 * not fly, hail, or Escape from. The bar now rebinds only while it is
 * still on screen, exactly as the spaceport does.
 */
describe('leaving the bar under a popup', () => {
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

    /** One stellar with a bar and one always-offered bar mission. */
    function gameData(): MockGameData {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET_ID, {
            ...getDefaultPlanetData(), id: PLANET_ID, name: 'Earth',
            flags: { ...getDefaultPlanetData().flags, hasBar: true },
        });
        data.data.Ship.map.set(SHIP_ID, {
            ...getDefaultShipData(), id: SHIP_ID, pict: '',
        });
        data.data.Mission.map.set(MISSION_ID, {
            ...getDefaultMissionData(), id: MISSION_ID,
            availLoc: LOCATION_BAR, availRandom: 100,
            offerText: 'Buy me a drink and I\'ll tell you.',
            acceptButton: 'Sure', refuseButton: 'No thanks',
        });
        return data;
    }

    function landedPilot(): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: SHIP_ID })
            .addComponent(CreditsComponent, { credits: 10000 })
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

    function internals(bar: Bar) {
        return bar as unknown as {
            controls: MenuControls,
            offerPopup: {
                container: PIXI.Container,
                choice: Subject<'accept' | 'refuse'>,
            },
            gamble: {
                container: PIXI.Container,
                buttons: { cancel: Button },
            },
            buttons: { leave: Button },
        };
    }

    /** Enters the bar, and resolves once its offer popup is up over it. */
    async function enterUnderOffer() {
        const controlEvents = new Subject<ControlEvent>();
        const data = gameData() as unknown as SimulationGameDataInterface;
        const bar = new Bar(displayAssets(), data, controlEvents,
            MissionUniverse.shared(data), PLANET_ID);
        await bar.buildPromise;
        const left = bar.show(landedPilot());
        const { offerPopup, buttons, controls, gamble } = internals(bar);
        await waitFor(() => offerPopup.container.visible);
        expect(bar.container.visible).toBeTrue();
        // The popup blocker holds the keyboard, not the bar.
        expect(MenuControls.focused).toBeDefined();
        expect(MenuControls.focused).not.toBe(controls);
        return { bar, controlEvents, left, offerPopup, buttons, controls, gamble };
    }

    afterEach(() => {
        // Whatever a spec did, nothing may be left holding the keyboard.
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    it('takes the keys back after the entry offers while still on screen',
        async () => {
            const { bar, controlEvents, left, offerPopup, controls } =
                await enterUnderOffer();
            offerPopup.choice.next('refuse');
            await waitFor(() => MenuControls.focused === controls);
            expect(bar.container.visible).toBeTrue();
            controlEvents.next({ action: 'depart', state: 'start' });
            await left;
            expect(MenuControls.focused).toBeUndefined();
        });

    it('does not rebind the keys of a bar left while an entry offer is up',
        async () => {
            const { bar, left, offerPopup, buttons } = await enterUnderOffer();
            buttons.leave.click.next({ shift: false, option: false });
            await waitFor(() => !bar.container.visible);
            // The offer sequence is still running blind.
            expect(offerPopup.container.visible).toBeTrue();
            offerPopup.choice.next('accept');
            await waitFor(() => !offerPopup.container.visible);
            expect(await left).toBeDefined();
            expect(MenuControls.focused).toBeUndefined();
        });

    it('does not rebind the keys of a bar left while the gamble dialog is up',
        async () => {
            const { bar, controlEvents, left, offerPopup, controls, gamble,
                buttons } = await enterUnderOffer();
            offerPopup.choice.next('refuse');
            await waitFor(() => MenuControls.focused === controls);
            controlEvents.next({ action: 'gamble', state: 'start' });
            await waitFor(() => gamble.container.visible);
            expect(MenuControls.focused).not.toBe(controls);
            // Leave under the dialog, then close the dialog.
            buttons.leave.click.next({ shift: false, option: false });
            await waitFor(() => !bar.container.visible);
            gamble.buttons.cancel.click.next({ shift: false, option: false });
            await waitFor(() => !gamble.container.visible);
            expect(await left).toBeDefined();
            expect(MenuControls.focused).toBeUndefined();
        });
});
