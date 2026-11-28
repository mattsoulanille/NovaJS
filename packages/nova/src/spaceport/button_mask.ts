// The button end caps' masks. Nova draws every interface button from
// three PICT pieces per state (left cap, middle, right cap; 7500-7508),
// and "Corresponding mask images are stored in PICTs 7600-7608" (EVN
// Bible, cölr section). The cap PICTs themselves are opaque 13x25
// rectangles: the rounded bezel sits on a flat dithered grey (64/72)
// field that the original never shows, because it copies the caps
// through their masks (black = draw, white = leave the panel). Only the
// caps have masks (7600/7602, 7603/7605, 7606/7608); the middles are
// opaque edge to edge and have none. Drawn without the masks, each button
// sat in a visible grey box on the textured dialog panels (verified
// against map_single_jump_route.png: the panel texture runs right up to
// the bezel along exactly the mask's white staircase).
import * as PIXI from 'pixi.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';

/** Each button cap PICT and the mask PICT the original copies it through. */
export const BUTTON_CAP_MASKS: ReadonlyMap<string, string> = new Map([
    ['nova:7500', 'nova:7600'],
    ['nova:7502', 'nova:7602'],
    ['nova:7503', 'nova:7603'],
    ['nova:7505', 'nova:7605'],
    ['nova:7506', 'nova:7606'],
    ['nova:7508', 'nova:7608'],
]);

/** Every mask PICT the buttons use (for the landed-UI prefetch). */
export const BUTTON_MASK_PICTS: readonly string[] =
    [...new Set(BUTTON_CAP_MASKS.values())];

type Pixels = Uint8Array | Uint8ClampedArray;

/**
 * Applies a mask image to an RGBA image in place, the way QuickDraw's
 * CopyMask treats a mask: a dark mask pixel copies the source pixel, a
 * light one leaves the destination (here: alpha 0, so whatever is drawn
 * behind shows). The masks are pure black and white (white decodes as 248,
 * QuickDraw's 5-bit full scale), so the threshold sits mid-way. Pixels
 * outside the mask (a mask smaller than the image) stay opaque.
 */
export function applyButtonMask(image: Pixels, imageWidth: number,
    imageHeight: number, mask: Pixels, maskWidth: number,
    maskHeight: number): void {
    const width = Math.min(imageWidth, maskWidth);
    const height = Math.min(imageHeight, maskHeight);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const m = (y * maskWidth + x) * 4;
            const luminance = (mask[m] + mask[m + 1] + mask[m + 2]) / 3;
            if (luminance >= 128) {
                const i = (y * imageWidth + x) * 4;
                image[i] = 0;
                image[i + 1] = 0;
                image[i + 2] = 0;
                image[i + 3] = 0;
            }
        }
    }
}

/** Resolves once a texture's image has loaded (rejects if it fails). */
function loaded(texture: PIXI.Texture): Promise<PIXI.BaseTexture> {
    const base = texture.baseTexture;
    if (base.valid) {
        return Promise.resolve(base);
    }
    return new Promise((resolve, reject) => {
        const onLoaded = () => {
            base.off('error', onError);
            resolve(base);
        };
        const onError = (error: unknown) => {
            base.off('loaded', onLoaded);
            reject(error);
        };
        base.once('loaded', onLoaded);
        base.once('error', onError);
    });
}

/** The drawable image behind a loaded texture, if it has one. */
function imageSource(base: PIXI.BaseTexture): CanvasImageSource | undefined {
    const source = (base.resource as { source?: unknown } | null)?.source;
    return source ? source as CanvasImageSource : undefined;
}

/**
 * The cap texture with its mask applied, as a canvas texture. Falls back to
 * the plain cap where there is nothing to composite with (no DOM, or a stub
 * texture with no image, as in the node specs).
 */
async function composeMaskedCap(displayAssets: DisplayAssetDataInterface,
    capId: string, maskId: string): Promise<PIXI.Texture> {
    if (typeof document === 'undefined') {
        return displayAssets.textureFromPict(capId);
    }
    const [cap, mask] = await Promise.all([
        displayAssets.textureFromPictAsync(capId),
        displayAssets.textureFromPictAsync(maskId),
    ]);
    if (!cap.baseTexture.resource || !mask.baseTexture.resource) {
        return cap;
    }
    const [capBase, maskBase] = await Promise.all([loaded(cap), loaded(mask)]);
    const capImage = imageSource(capBase);
    const maskImage = imageSource(maskBase);
    if (!capImage || !maskImage) {
        return cap;
    }
    const width = capBase.realWidth;
    const height = capBase.realHeight;
    const maskWidth = maskBase.realWidth;
    const maskHeight = maskBase.realHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(width, maskWidth);
    canvas.height = Math.max(height, maskHeight);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
        return cap;
    }
    context.drawImage(maskImage, 0, 0);
    const maskPixels = context.getImageData(0, 0, maskWidth, maskHeight).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(capImage, 0, 0);
    const capPixels = context.getImageData(0, 0, width, height);
    applyButtonMask(capPixels.data, width, height, maskPixels, maskWidth,
        maskHeight);
    canvas.width = width;
    canvas.height = height;
    context.putImageData(capPixels, 0, 0);
    return PIXI.Texture.from(canvas);
}

interface MaskedCap {
    /** Set once composed, so later buttons draw it the frame they are made. */
    texture?: PIXI.Texture;
    promise: Promise<PIXI.Texture>;
}

/** Per asset source, so a stub in one spec never leaks into another. */
const maskedCaps = new WeakMap<DisplayAssetDataInterface,
    Map<string, MaskedCap>>();

function maskedCap(displayAssets: DisplayAssetDataInterface, capId: string,
    maskId: string): MaskedCap {
    let caps = maskedCaps.get(displayAssets);
    if (!caps) {
        caps = new Map();
        maskedCaps.set(displayAssets, caps);
    }
    const cached = caps.get(capId);
    if (cached) {
        return cached;
    }
    const entry: MaskedCap = {
        promise: composeMaskedCap(displayAssets, capId, maskId).then(
            texture => {
                entry.texture = texture;
                return texture;
            },
            error => {
                // Not cached: a later button tries again. Meanwhile the
                // unmasked cap beats a missing one.
                caps!.delete(capId);
                console.warn(`Button cap ${capId} mask ${maskId}:`, error);
                return displayAssets.textureFromPict(capId);
            }),
    };
    caps.set(capId, entry);
    return entry;
}

/**
 * A sprite of a button cap drawn through its mask (BUTTON_CAP_MASKS); a
 * PICT without a mask is the plain sprite. The masked texture is composed
 * once per cap and shared by every button. Until it is ready the sprite is
 * empty rather than the unmasked rectangle.
 */
export function maskedCapSprite(displayAssets: DisplayAssetDataInterface,
    capId: string): PIXI.Sprite {
    const maskId = BUTTON_CAP_MASKS.get(capId);
    if (!maskId) {
        return displayAssets.spriteFromPict(capId);
    }
    const entry = maskedCap(displayAssets, capId, maskId);
    if (entry.texture) {
        return new PIXI.Sprite(entry.texture);
    }
    const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
    void entry.promise.then(texture => {
        if (!sprite.destroyed) {
            sprite.texture = texture;
        }
    });
    return sprite;
}
