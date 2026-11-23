import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { Button } from './button.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { STARMAP_BUTTONS, Starmap } from './starmap.js';
import {
    ZOOM_CAP_OVERLAP, ZOOM_GLYPH_RECTS, ZoomButton,
} from './starmap_zoom_button.js';

/**
 * The star map's button row against map_single_jump_route.png (1920x1080,
 * the dialog centred at x 960): reference_experiments R8 item 4.
 */
describe('the star map\'s button row', () => {
    beforeAll(() => installHeadlessPixi());

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

    function buttons(): Record<string, Button> {
        const starmap = new Starmap(displayAssets(),
            new MockGameData() as unknown as SimulationGameDataInterface,
            'nova:128', new Subject<ControlEvent>());
        return (starmap as unknown as { buttons: Record<string, Button> })
            .buttons;
    }

    it('zooms with two round icon buttons, not "-"/"+" pills', () => {
        const { zoomOut, zoomIn } = buttons();
        expect(zoomOut).toBeInstanceOf(ZoomButton);
        expect(zoomIn).toBeInstanceOf(ZoomButton);
        // No caption: the glyph is drawn.
        const captions = [zoomOut, zoomIn].map(b => b.container.children
            .filter((c): c is PIXI.Text => c instanceof PIXI.Text)
            .map(t => t.text).join(''));
        expect(captions).toEqual(['', '']);
        // The discs sit 30 px apart (x 1080 and 1110 on the capture).
        expect(zoomIn.container.x - zoomOut.container.x).toBe(30);
    });

    it('makes each disc from the two caps, overlapping by a pixel', () => {
        const { zoomOut } = buttons();
        // Every state's caps: [left, middle, right] (button.ts).
        const states = zoomOut.container.children.filter(
            c => (c as PIXI.Container).children?.length === 3);
        expect(states.length).toBe(3);
        for (const state of states) {
            const [left, middle, right] = (state as PIXI.Container).children;
            expect((middle as PIXI.TilingSprite).width).toBe(0);
            expect(left.x - right.x).toBe(ZOOM_CAP_OVERLAP);
        }
    });

    it('draws the measured glyphs', () => {
        expect(ZOOM_GLYPH_RECTS.minus).toEqual([{ x: 11, y: 12, w: 6, h: 2 }]);
        expect(ZOOM_GLYPH_RECTS.plus.map(r => r.w * r.h)).toEqual([16, 16]);
    });

    it('sizes Find and Done alike, as the original does', () => {
        expect(STARMAP_BUTTONS.find.width).toBe(STARMAP_BUTTONS.done.width);
        // Their red cores measure 85 px across (x 954..1038, 1149..1233).
        expect(STARMAP_BUTTONS.find.width).toBe(73);
    });

    it('places each button where the capture has it', () => {
        const all = buttons();
        for (const [name, { x }] of Object.entries(STARMAP_BUTTONS)) {
            expect(all[name].container.x).withContext(name).toBe(x);
        }
    });
});
