import { BaseData } from "novadatainterface/BaseData";
import { BaseParse } from "./BaseParse";
import { BaseResource } from "../resource_parsers/NovaResourceBase";
import { SpriteSheetData, DefaultSpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData, ConvexHulls, DefaultConvexHulls, FrameInfo, ConvexHull, DefaultImageLocation } from "novadatainterface/SpriteSheetData";
import { RledResource } from "../resource_parsers/RledResource";
import { PNG } from "pngjs";
import * as path from "path";

//import hull = require("hull.js");
//import hull from "hull.js";



type SpriteSheetMulti = {
    spriteSheet: SpriteSheetData,
    spriteSheetImage: SpriteSheetImageData,
    spriteSheetFrames: SpriteSheetFramesData
}


const SHEET_LOOP = 10;

class DimensionError extends Error { };

function getWH(frames: Array<PNG>): { singleFrameWidth: number, singleFrameHeight: number, fullPixelWidth: number, fullPixelHeight: number } {
    var singleFrameWidth = frames[0].width;
    var singleFrameHeight = frames[0].width;

    var fullPixelWidth: number = Math.min(SHEET_LOOP, frames.length) * singleFrameWidth;
    var fullPixelHeight: number = Math.ceil(frames.length / SHEET_LOOP) * singleFrameHeight;

    return {
        fullPixelHeight,
        fullPixelWidth,
        singleFrameHeight,
        singleFrameWidth
    }
}

function buildPNG(frames: Array<PNG>): PNG {
    var { fullPixelHeight, fullPixelWidth, singleFrameHeight, singleFrameWidth } = getWH(frames);

    var outPNG = new PNG({
        filterType: 4,
        width: fullPixelWidth,
        height: fullPixelHeight
    });

    for (let f = 0; f < frames.length; f++) {
        let frame = frames[f];

        // Validation for sanity
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


// Includes in its output any points that are not black
function makeVisibleArray(png: PNG): Array<[number, number]> {
    var visibleArray: Array<[number, number]> = [];

    var origin = [png.width / 2, png.height / 2];

    for (var y = 0; y < png.height; y++) {
        for (var x = 0; x < png.width; x++) {
            var idx = (png.width * y + x) << 2;
            if (png.data[idx + 3] === 255) {
                visibleArray.push([x - origin[0], -(y - origin[1])]);
            }

        }
    }
    return visibleArray;
}

function makeConvexHull(png: PNG): ConvexHull {
    // No concavity. Convex hull.
    var visibleArray = makeVisibleArray(png);
    //TODO: Fix convex hulls!
    //var hullWithRepeat = hull(visibleArray, Infinity);
    var hullWithRepeat: ConvexHull = [[-10, -10], [10, -10], [10, 10], [-10, 10], [1, 2]];
    // Cut off the last point since it's the same as the first.
    return hullWithRepeat.slice(0, hullWithRepeat.length - 1);
}


function buildConvexHulls(frames: Array<PNG>): ConvexHulls {
    return frames.map(makeConvexHull);
}



function buildSpriteSheetFrames(rled: RledResource): SpriteSheetFramesData {
    var frames = rled.frames;
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
async function SpriteSheetMultiParse(rled: RledResource, notFoundFunction: (m: string) => void): Promise<SpriteSheetMulti> {
    var base: BaseData = await BaseParse(rled, notFoundFunction);


    var assembledPNG: PNG = buildPNG(rled.frames);
    var spriteSheetImage: SpriteSheetImageData = PNG.sync.write(assembledPNG);



    // TODO: Convex Hulls
    var convexHulls = buildConvexHulls(rled.frames);
    var spriteSheet: SpriteSheetData = {
        ...base,
        convexHulls
    }

    var spriteSheetFrames: SpriteSheetFramesData = buildSpriteSheetFrames(rled);


    return {
        spriteSheet,
        spriteSheetImage,
        spriteSheetFrames
    };
};


export { SpriteSheetMultiParse, SpriteSheetMulti }
