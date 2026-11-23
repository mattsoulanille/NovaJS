import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MINI_MAP_ZOOM } from './mini_map.js';
import { Starmap } from './starmap.js';
import { BASE_SCALE } from './starmap_viewport.js';

/**
 * The original's map scale (docs/reference_experiments.md, M6): the full
 * map OPENS at ~1.77 px per map unit — measured on the test kit's map
 * region, where every system sits a known distance from the hub — and the
 * `h` minimap draws at the same scale.
 */
describe('the full star map\'s default zoom', () => {
    beforeAll(() => installHeadlessPixi());

    const HUB = 'nova:2140';
    const SOUTH = 'nova:2141';

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
            position: [-700, 400], links: [SOUTH],
        });
        data.data.System.map.set(SOUTH, {
            ...getDefaultSystemData(), id: SOUTH, name: 'Map South',
            position: [-700, 460], links: [HUB],
        });
        return data;
    }

    /** Screen pixels per map unit of the open map's graph. */
    function pxPerUnit(starmap: Starmap): number {
        const graph = (starmap as unknown as {
            systemGraph?: { zoom: number },
        }).systemGraph;
        return (graph?.zoom ?? NaN) * BASE_SCALE;
    }

    it('opens at 1.77 px per map unit, not 2', async () => {
        const starmap = new Starmap(displayAssets(),
            gameData() as unknown as SimulationGameDataInterface, HUB,
            new Subject<ControlEvent>());
        await starmap.buildPromise;
        const shown = starmap.show([]);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(pxPerUnit(starmap)).toBeCloseTo(1.77, 5);
        // Map South, 60 units below the hub, measured +106 px.
        expect(Math.round(60 * pxPerUnit(starmap))).toBe(106);
        starmap.dismiss();
        await shown;
    });

    it('is the scale the `h` minimap draws at', () => {
        expect(MINI_MAP_ZOOM * BASE_SCALE).toBeCloseTo(1.77, 5);
    });
});
