import { BaseData } from "novadatainterface/base_data";
import { BaseParse } from "./base_parse.js";
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData, Hull, FrameInfo, ConvexHull, DefaultImageLocation, getDefaultConvexHull } from "novadatainterface/sprite_sheet_data";
import { RledResource } from "../resource_parsers/rled_resource.js";
import { PNG } from "pngjs";
import * as path from "path";
import hull from 'hull.js';
import { bufferToArrayBuffer } from "./buffer_to_array_buffer.js";
import { decomposePolygon, Point } from "../hull/convex_decomposition.js";
import { Mask, simplifyPolygon, traceOutline } from "../hull/trace_outline.js";
import {
    HullOverlayMap, overlayFramesForBaseFrame,
} from "./hull_overlay_map.js";


export interface SpriteSheetMulti {
    spriteSheet: SpriteSheetData;
    spriteSheetImage: SpriteSheetImageData;
    spriteSheetFrames: SpriteSheetFramesData;
}

const SHEET_LOOP = 10;

export class DimensionError extends Error { };

/**
 * The packed sheet's geometry: every frame is `singleFrameWidth` x
 * `singleFrameHeight` (the rlëD's own size — a sheet is one resource, so
 * every frame shares it), laid out SHEET_LOOP to a row.
 *
 * The frame height is the frame's HEIGHT. It used to be copied from the
 * width, which is invisible for the square ship sprites but wrong for
 * every non-square rlëD: the stock stations (CC Station nova:2034 is
 * 140x85, Double-Deimos nova:2039 315x200), the hypergates (nova:2063,
 * 53x60), the ground explosion (nova:4006, 50x63). A wide frame in a
 * width x width rect is centred by the sprite anchor (w-h)/2 px above
 * the entity — tens of pixels north of where the ship lands or the
 * shots hit — and a tall one has its bottom rows written past its row
 * block, i.e. cropped (or overwritten by the next row of frames).
 */
export function getWH(frames: Array<PNG>): { singleFrameWidth: number, singleFrameHeight: number, fullPixelWidth: number, fullPixelHeight: number } {
    var singleFrameWidth = frames[0].width;
    var singleFrameHeight = frames[0].height;

    var fullPixelWidth: number = Math.min(SHEET_LOOP, frames.length) * singleFrameWidth;
    var fullPixelHeight: number = Math.ceil(frames.length / SHEET_LOOP) * singleFrameHeight;

    return {
        fullPixelHeight,
        fullPixelWidth,
        singleFrameHeight,
        singleFrameWidth
    }
}

/** Packs the frames into one sheet image, SHEET_LOOP frames per row. */
export function buildPNG(frames: Array<PNG>): PNG {
    var { fullPixelHeight, fullPixelWidth, singleFrameHeight, singleFrameWidth } = getWH(frames);

    var outPNG = new PNG({
        filterType: 4,
        width: fullPixelWidth,
        height: fullPixelHeight
    });

    for (let f = 0; f < frames.length; f++) {
        let frame = frames[f];

        // Every frame must fit the row pitch computed from frame 0: a
        // larger one would write into (or past) its neighbours' pixels.
        // An rlëD carries one size for all its frames, so this never
        // fires on decoded game data; it guards the packer's contract.
        if (frame.width != singleFrameWidth || frame.height != singleFrameHeight) {
            throw new DimensionError("Wrong dimensions " + frame.width + " by " + frame.height
                + ". Expected " + singleFrameWidth + " by " + singleFrameHeight + ".");
        }

        var col = f % SHEET_LOOP;
        var row = Math.floor(f / SHEET_LOOP);

        for (var y = 0; y < frame.height; y++) {
            for (var x = 0; x < frame.width; x++) {
                var frameIDX = (frame.width * y + x) << 2;

                var pngIDX = (outPNG.width * y +       // skip to next row of pixels

                    outPNG.width *           // skip to next row of frames
                    singleFrameHeight * row +

                    x +                         // skip to next col of pixels
                    singleFrameWidth * col       // skip to next col of frames
                ) << 2;

                outPNG.data[pngIDX] = frame.data[frameIDX];
                outPNG.data[pngIDX + 1] = frame.data[frameIDX + 1];
                outPNG.data[pngIDX + 2] = frame.data[frameIDX + 2];
                outPNG.data[pngIDX + 3] = frame.data[frameIDX + 3];
                // is there a better way?
            }
        }
    }

    return outPNG;
}


/** A sprite frame's fully-opaque pixels, for hull tracing. */
function pngMask(png: PNG): Mask {
    return {
        width: png.width,
        height: png.height,
        isFilled: (x, y) => x >= 0 && x < png.width && y >= 0 && y < png.height
            && png.data[(png.width * y + x) * 4 + 3] === 255,
    };
}

/**
 * The opaque pixels of several sprite frames laid on top of each other,
 * each centred in the combined canvas — the same way the display stacks a
 * ship's layers (every sprite in an AnimationGraphic shares one container
 * and is anchored at its own centre).
 *
 * Materialized into a byte array rather than composed as nested
 * predicates because traceOutline probes every pixel several times.
 */
export function unionMask(masks: Mask[]): Mask {
    const width = Math.max(...masks.map(m => m.width));
    const height = Math.max(...masks.map(m => m.height));
    const filled = new Uint8Array(width * height);
    for (const mask of masks) {
        // Integer offsets keep the union deterministic; both of stock
        // Nova's layers are the same even size, so nothing shifts.
        const offsetX = (width - mask.width) >> 1;
        const offsetY = (height - mask.height) >> 1;
        for (let y = 0; y < mask.height; y++) {
            for (let x = 0; x < mask.width; x++) {
                if (mask.isFilled(x, y)) {
                    filled[(y + offsetY) * width + (x + offsetX)] = 1;
                }
            }
        }
    }
    return {
        width, height,
        isFilled: (x, y) => x >= 0 && x < width && y >= 0 && y < height
            && filled[y * width + x] === 1,
    };
}

// Includes in its output any points that are not black
function makeVisibleArray(mask: Mask): Array<[number, number]> {
    var visibleArray: Array<[number, number]> = [];

    var origin = [mask.width / 2, mask.height / 2];

    for (var y = 0; y < mask.height; y++) {
        for (var x = 0; x < mask.width; x++) {
            if (mask.isFilled(x, y)) {
                visibleArray.push([x - origin[0], -(y - origin[1])]);
            }

        }
    }
    return visibleArray;
}

function makeConvexHull(mask: Mask): ConvexHull {
    // No concavity. Convex hull.
    var visibleArray = makeVisibleArray(mask);
    var hullWithRepeat = hull(visibleArray, Infinity) as ConvexHull;
    // If the hull is empty, return the default conved hull instead.
    if (hullWithRepeat.length === 0 || hullWithRepeat[0] === undefined) {
        return getDefaultConvexHull();
    }
    // Cut off the last point since it's the same as the first.
    return hullWithRepeat.slice(0, hullWithRepeat.length - 1);
}

// Simplification tolerance for the traced pixel outline, in pixels.
const OUTLINE_SIMPLIFY_EPSILON = 1;
// A component may be dented by up to this fraction of the sprite's size
// (with a floor in pixels) before it gets split further.
const CONCAVITY_TOLERANCE_RATIO = 0.05;
const MIN_CONCAVITY_TOLERANCE = 3;
// Keep hitboxes cheap: SAT tests each pair of convex components.
const MAX_HULL_COMPONENTS = 8;

// Approximate convex decomposition (Lien & Amato) of the sprite's pixel
// outline, so concave ships get a hull per protrusion instead of one
// convex hull spanning their notches. Purely deterministic in the sprite
// data; collision geometry must match across clients.
function makeHull(mask: Mask): Hull {
    const outline = traceOutline(mask);
    if (outline) {
        // Same centered, y-up frame as makeVisibleArray.
        const centered = outline.map(([x, y]): Point =>
            [x - mask.width / 2, -(y - mask.height / 2)]);
        const simplified = simplifyPolygon(centered, OUTLINE_SIMPLIFY_EPSILON);
        const tolerance = Math.max(MIN_CONCAVITY_TOLERANCE,
            Math.max(mask.width, mask.height) * CONCAVITY_TOLERANCE_RATIO);
        const components = decomposePolygon(
            simplified, tolerance, MAX_HULL_COMPONENTS);
        if (components.length > 0) {
            return components;
        }
    }
    return [makeConvexHull(mask)];
}

/**
 * One hull per frame of the base sheet, with the shän's always-drawn alt
 * layer (if any) folded in.
 *
 * traceOutline keeps only the LARGEST connected region, so a ship whose
 * base sheet is two disconnected pieces — the Aurora Thunderforge's fore
 * and aft sections — used to get a hull around one piece and nothing
 * else. Unioning the alt drum that visually bridges them also reconnects
 * the silhouette, which is what makes a single traced outline correct
 * again.
 */
export function makeHulls(frames: Array<PNG>,
    overlay?: { frames: Array<PNG>, framesPer: number }): Hull[] {
    if (!overlay || overlay.frames.length === 0) {
        // Byte-for-byte the pre-overlay path: one mask, no compositing.
        return frames.map(frame => makeHull(pngMask(frame)));
    }
    const overlayMasks = overlay.frames.map(pngMask);
    return frames.map((frame, index) => {
        const masks = [pngMask(frame)];
        for (const overlayFrame of overlayFramesForBaseFrame(
            index, overlay.framesPer, overlayMasks.length)) {
            masks.push(overlayMasks[overlayFrame]);
        }
        return makeHull(unionMask(masks));
    });
}

/**
 * The PIXI spritesheet frame table for a packed sheet: one `w x h` rect
 * per frame at its (col, row) slot, with the same geometry buildPNG laid
 * the pixels out in. Only `rled.globalID` is read.
 */
export function buildSpriteSheetFrames(rled: Pick<RledResource, 'globalID'>,
    frames: Array<PNG>): SpriteSheetFramesData {
    var { fullPixelHeight, fullPixelWidth, singleFrameHeight, singleFrameWidth } = getWH(frames);

    var imagePath = path.join(DefaultImageLocation, rled.globalID + ".png");

    var meta = {
        format: "RGBA8888",
        size: {
            w: fullPixelWidth,
            h: fullPixelHeight
        },
        scale: "1",
        image: imagePath
    }

    var frameInfoObj: { [index: string]: FrameInfo } = {};

    for (var f = 0; f < frames.length; f++) {
        var col = f % SHEET_LOOP;
        var row = Math.floor(f / SHEET_LOOP);

        frameInfoObj[rled.globalID + " " + f + ".png"] = {
            frame: {
                x: col * singleFrameWidth,
                y: row * singleFrameHeight,
                w: singleFrameWidth,
                h: singleFrameHeight
            },
            rotated: false,
            trimmed: false,
            sourceSize: { w: fullPixelWidth, h: fullPixelHeight }
        };
    }

    return {
        frames: frameInfoObj,
        meta
    }
}



// Parses SpriteSheet, SpriteSheetImage, and SpriteSheetFrames at the same time
// They are separated from each other due to PIXI.js peculiarities.
export async function SpriteSheetMultiParse(rled: RledResource,
    notFoundFunction: (m: string) => void,
    overlayFrames?: { frames: Array<PNG>, framesPer: number },
): Promise<SpriteSheetMulti> {
    const base: BaseData = await BaseParse(rled, notFoundFunction);

    // `frames` is a getter that re-decodes the whole sheet on every read.
    const frames = rled.frames;

    const assembledPNG: PNG = buildPNG(frames);
    const buf = PNG.sync.write(assembledPNG);
    const spriteSheetImage = bufferToArrayBuffer(buf);

    const spriteSheet: SpriteSheetData = {
        ...base,
        hulls: makeHulls(frames, overlayFrames),
    }

    const spriteSheetFrames = buildSpriteSheetFrames(rled, frames);

    return {
        spriteSheet,
        spriteSheetImage,
        spriteSheetFrames
    };
};

/**
 * SpriteSheetMultiParse bound to the id space's base-image -> alt-image
 * map, so a ship whose hull is split across two sprite layers (the Aurora
 * Thunderforge) gets one collision hull covering both. See
 * hull_overlay_map.ts.
 */
export function SpriteSheetMultiParseClosure(
    overlayMap: Promise<HullOverlayMap>,
    overlayFrames: (overlayId: string) => Promise<Array<PNG> | undefined>) {
    return async function(rled: RledResource,
        notFoundFunction: (m: string) => void): Promise<SpriteSheetMulti> {
        const entry = (await overlayMap)[rled.globalID];
        let overlay: { frames: Array<PNG>, framesPer: number } | undefined;
        if (entry) {
            const frames = await overlayFrames(entry.overlayId);
            if (frames?.length) {
                overlay = { frames, framesPer: entry.framesPer };
            } else {
                notFoundFunction(`rlëD id ${rled.globalID} names hull`
                    + ` overlay ${entry.overlayId}, which is not available.`);
            }
        }
        return SpriteSheetMultiParse(rled, notFoundFunction, overlay);
    };
}
