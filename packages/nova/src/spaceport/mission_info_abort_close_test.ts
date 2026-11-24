import 'jasmine';
import { getDefaultMissionData } from 'novadatainterface/mission_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    ActiveMission, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { Button } from './button.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { MissionInfoDialog } from './mission_info.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * The in-flight Mission Info dialog's Abort closes the WHOLE dialog, with
 * no confirmation (reference "Aborting a mission in flight from the `i`
 * dialog, wave 13": the click on Abort closed it at once, and `i` then
 * said "You have no active missions."). It used to stay open on the
 * shortened list.
 */
describe('the Mission Info dialog\'s Abort', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => {
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    const FIRST = 'nova:600';
    const SECOND = 'nova:601';

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

    function active(id: string): ActiveMission {
        return {
            id, acceptedDay: 0, acceptedAt: 'nova:128', travelPlanet: null,
            returnPlanet: null, cargoType: -1, cargoQty: 0,
            cargoLoaded: false, travelDone: false, deadlineDay: null,
        };
    }

    async function waitFor(ready: () => boolean) {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).toBe(true);
    }

    it('closes the dialog at once, leaving the other missions be',
        async () => {
            const data = new MockGameData();
            for (const id of [FIRST, SECOND]) {
                data.data.Mission.map.set(id, {
                    ...getDefaultMissionData(), id, name: id,
                    quickBrief: `Brief for ${id}`, canAbort: true,
                });
            }
            const universe = MissionUniverse.shared(
                data as unknown as SimulationGameDataInterface);
            const dialog = new MissionInfoDialog(displayAssets(), universe,
                new Subject<ControlEvent>());
            const player = new Entity('pilot')
                .addComponent(MissionsComponent, new Map([
                    [FIRST, active(FIRST)], [SECOND, active(SECOND)]]))
                .addComponent(ControlBitsComponent, new Set<number>())
                .addComponent(GameDateComponent,
                    { day: 1, month: 1, year: 1177 });
            const aborted: string[] = [];
            const closed = dialog.show(player, async id => {
                aborted.push(id);
                return true;
            });
            await waitFor(() => dialog.container.visible);

            const abort = (dialog as unknown as { abort: Button }).abort;
            expect(abort.state).toBe('normal');
            abort.click.next({ shift: false, option: false });
            await closed;

            expect(aborted).toEqual([FIRST]);
            expect(dialog.container.visible).toBeFalse();
            expect(MenuControls.focused).toBeUndefined();
        });
});
