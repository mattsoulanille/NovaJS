import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import { FindDialog } from './find_dialog.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Starmap } from './starmap.js';
import { DEFAULT_ZOOM, ZOOM_STEP } from './starmap_viewport.js';

/**
 * The map's zoom and Find keys (reference "Map keys, minimap routes and
 * ctrl-clicks (K4, M2, M3), wave 41"): `=` zooms in and `-` out, one step
 * each, the same step as the + / - buttons; `f` opens Find, which takes a
 * system name and centres and selects it.
 */
describe('star map keys (K4, wave 41)', () => {
    beforeAll(() => installHeadlessPixi());

    const HUB = 'nova:2140';
    const EAST = 'nova:2143';
    const FAR = 'nova:2146';

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

    function gameData(): MockGameData {
        const data = new MockGameData();
        data.data.System.map.set(HUB, {
            ...getDefaultSystemData(), id: HUB, name: 'Map Hub',
            position: [-700, 400], links: [EAST],
        });
        data.data.System.map.set(EAST, {
            ...getDefaultSystemData(), id: EAST, name: 'Map East',
            position: [-660, 400], links: [HUB, FAR],
        });
        data.data.System.map.set(FAR, {
            ...getDefaultSystemData(), id: FAR, name: 'Map Far',
            position: [-580, 400], links: [EAST],
        });
        return data;
    }

    interface Internals {
        systemGraph?: { zoom: number };
        findDialog: FindDialog;
    }

    async function openMap() {
        const controls = new Subject<ControlEvent>();
        const starmap = new Starmap(displayAssets(),
            gameData() as unknown as SimulationGameDataInterface, HUB,
            controls);
        await starmap.buildPromise;
        const selected: string[] = [];
        const shown = starmap.show([]);
        await new Promise(resolve => setTimeout(resolve, 0));
        const internals = starmap as unknown as Internals;
        (internals.systemGraph as unknown as {
            infoSelection: Subject<string>,
        }).infoSelection.subscribe(id => selected.push(id));
        const press = (action: ControlAction) =>
            controls.next({ action, state: 'start' });
        const zoom = () => internals.systemGraph?.zoom ?? NaN;
        return { starmap, shown, internals, press, zoom, selected };
    }

    it('zooms one button step in on `=` and out on `-`', async () => {
        const { starmap, shown, press, zoom } = await openMap();
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM, 6);
        press('globalScaleUp');
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM * ZOOM_STEP ** 2, 6);
        press('globalScaleDown');
        press('globalScaleDown');
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM / ZOOM_STEP ** 2, 6);
        starmap.dismiss();
        await shown;
    });

    it('takes the same step as the - / + buttons', async () => {
        const { starmap, shown, zoom } = await openMap();
        const buttons = (starmap as unknown as {
            buttons: Record<'zoomIn' | 'zoomOut',
                { click: Subject<void> }>,
        }).buttons;
        buttons.zoomIn.click.next();
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM * ZOOM_STEP ** 2, 6);
        buttons.zoomOut.click.next();
        buttons.zoomOut.click.next();
        expect(zoom()).toBeCloseTo(DEFAULT_ZOOM / ZOOM_STEP ** 2, 6);
        starmap.dismiss();
        await shown;
    });

    it('opens Find on `f`; Find selects the named system', async () => {
        const { starmap, shown, internals, press, selected } = await openMap();
        const find = internals.findDialog;
        expect(find.shown).toBeFalse();
        press('attack');
        expect(find.shown).toBeTrue();
        find.type('Map Far');
        find.confirm();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(find.shown).toBeFalse();
        expect(selected).toContain(FAR);
        starmap.dismiss();
        await shown;
    });

    it('leaves the display scale keys alone while Find is up', async () => {
        const { starmap, shown, internals, press, zoom } = await openMap();
        press('attack');
        const before = zoom();
        // The field holds the keyboard (its own focused MenuControls).
        press('globalScaleUp');
        expect(zoom()).toBe(before);
        internals.findDialog.cancel();
        await new Promise(resolve => setTimeout(resolve, 0));
        starmap.dismiss();
        await shown;
    });
});
