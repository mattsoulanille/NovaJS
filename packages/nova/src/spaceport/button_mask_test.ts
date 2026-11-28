import 'jasmine';
import { PNG } from 'pngjs';
import * as PIXI from 'pixi.js';
import { applyButtonMask, BUTTON_CAP_MASKS, BUTTON_MASK_PICTS, maskedCapSprite }
    from './button_mask.js';
import { BUTTON_PICTS } from './button.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';

/** A w x h RGBA image filled with one colour. */
function solid(width: number, height: number,
    rgba: [number, number, number, number]): Uint8Array {
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
        pixels.set(rgba, i);
    }
    return pixels;
}

function alphaAt(pixels: Uint8Array, width: number, x: number, y: number) {
    return pixels[(y * width + x) * 4 + 3];
}

describe('button cap masks', () => {
    it('keeps the pixels under black and clears the ones under white '
        + '(QuickDraw white decodes as 248)', () => {
        const image = solid(2, 1, [64, 64, 64, 255]);
        const mask = new Uint8Array([
            248, 248, 248, 255, // white: the panel shows through
            0, 0, 0, 255, //       black: the cap draws
        ]);
        applyButtonMask(image, 2, 1, mask, 2, 1);
        expect([...image.slice(0, 4)]).toEqual([0, 0, 0, 0]);
        expect([...image.slice(4, 8)]).toEqual([64, 64, 64, 255]);
    });

    it('leaves pixels outside a smaller mask opaque', () => {
        const image = solid(3, 2, [10, 20, 30, 255]);
        const mask = solid(1, 1, [248, 248, 248, 255]);
        applyButtonMask(image, 3, 2, mask, 1, 1);
        expect(alphaAt(image, 3, 0, 0)).toBe(0);
        expect(alphaAt(image, 3, 1, 0)).toBe(255);
        expect(alphaAt(image, 3, 0, 1)).toBe(255);
        expect(alphaAt(image, 3, 2, 1)).toBe(255);
    });

    it('masks every cap (7600-7608, the Bible\'s ids) and no middle', () => {
        expect([...BUTTON_CAP_MASKS].sort()).toEqual([
            ['nova:7500', 'nova:7600'], ['nova:7502', 'nova:7602'],
            ['nova:7503', 'nova:7603'], ['nova:7505', 'nova:7605'],
            ['nova:7506', 'nova:7606'], ['nova:7508', 'nova:7608'],
        ]);
        for (const middle of ['nova:7501', 'nova:7504', 'nova:7507']) {
            expect(BUTTON_CAP_MASKS.has(middle)).toBeFalse();
        }
        // The landed-UI prefetch warms the masks with the caps.
        for (const mask of BUTTON_MASK_PICTS) {
            expect(BUTTON_PICTS).toContain(mask);
        }
    });

    it('draws an unmasked PICT as its plain sprite, and a masked cap as the '
        + 'plain cap texture with no DOM to composite in', async () => {
        const plain = new PIXI.Sprite();
        const capTexture = new PIXI.Texture(new PIXI.BaseTexture());
        const assets = {
            spriteFromPict: () => plain,
            textureFromPict: (id: string) =>
                id === 'nova:7500' ? capTexture : PIXI.Texture.EMPTY,
        } as unknown as DisplayAssetDataInterface;
        expect(maskedCapSprite(assets, 'nova:7501')).toBe(plain);
        const cap = maskedCapSprite(assets, 'nova:7500');
        expect(cap).not.toBe(plain);
        // Empty until composed, never the unmasked rectangle in between.
        expect(cap.texture).toBe(PIXI.Texture.EMPTY);
        await new Promise(resolve => setTimeout(resolve));
        expect(cap.texture).toBe(capTexture);
        // Composed once: the next button's cap draws at once.
        expect(maskedCapSprite(assets, 'nova:7500').texture).toBe(capTexture);
    });

    describe('in the game data', () => {
        async function decode(id: string): Promise<PNG> {
            const gameData = await getIntegrationGameData();
            const buffer = await gameData.data.PictImage.get(id);
            return PNG.sync.read(Buffer.from(buffer));
        }

        for (const [capId, maskId] of BUTTON_CAP_MASKS) {
            it(`${maskId} cuts ${capId}'s grey field away and nothing else`,
                async () => {
                    const cap = await decode(capId);
                    const mask = await decode(maskId);
                    expect([mask.width, mask.height])
                        .toEqual([cap.width, cap.height]);
                    const masked = Uint8Array.from(cap.data);
                    applyButtonMask(masked, cap.width, cap.height,
                        mask.data, mask.width, mask.height);
                    const removed: string[] = [];
                    for (let i = 0; i < masked.length; i += 4) {
                        if (masked[i + 3] === 0) {
                            removed.push([...cap.data.slice(i, i + 3)]
                                .join(','));
                        }
                    }
                    // The rounded end's surround: ~58 pixels, all of them
                    // the 64/72 dither the original never shows.
                    expect(removed.length).toBeGreaterThan(50);
                    for (const value of new Set(removed)) {
                        expect(value).toMatch(/^(64|72),(64|72),(64|72)$/);
                    }
                    // The outer corners go; the edge that meets the middle
                    // strip stays whole, so no seam opens there.
                    const left = capId === 'nova:7500' || capId === 'nova:7503'
                        || capId === 'nova:7506';
                    const outer = left ? 0 : cap.width - 1;
                    const inner = left ? cap.width - 1 : 0;
                    expect(alphaAt(masked, cap.width, outer, 0)).toBe(0);
                    expect(alphaAt(masked, cap.width, outer, cap.height - 1))
                        .toBe(0);
                    for (let y = 0; y < cap.height; y++) {
                        expect(alphaAt(masked, cap.width, inner, y)).toBe(255);
                    }
                });
        }
    });
});
