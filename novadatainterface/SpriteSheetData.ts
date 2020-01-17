import { BaseData, DefaultBaseData } from "./BaseData";
import fs from "fs";
import path from "path";

type ConvexHull = Array<[number, number]>;


// A box around the origin
const DefaultConvexHull: ConvexHull = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
];

type ConvexHulls = Array<ConvexHull>;
const DefaultConvexHulls = [DefaultConvexHull];


interface SpriteSheetData extends BaseData {
    convexHulls: Array<ConvexHull>
}


const DefaultSpriteSheetData: SpriteSheetData = {
    ...DefaultBaseData,
    convexHulls: DefaultConvexHulls
}



type SpriteSheetImageData = Buffer;

//const defaultRledPath = path.join(__dirname, "defaultRled.png");
debugger;
console.log("\n\n\n\n");
const defaultRledPath = require.resolve("novajs/novadatainterface/defaultRled.png");
console.log(defaultRledPath);
debugger;

const DefaultSpriteSheetImage = fs.readFileSync(defaultRledPath);

type FrameInfo = {
    frame: {
        x: number,
        y: number,
        w: number,
        h: number
    },
    rotated: boolean,
    trimmed: boolean,
    sourceSize: {
        w: number,
        h: number
    }
};

type SpriteSheetFramesData = {
    frames: {
        [index: string]: FrameInfo,
    },
    meta: {
        format: string,
        size: {
            w: number,
            h: number
        },
        scale: string,
        image: string // The file path to the image
    }
}


const DefaultImageLocation = "../SpriteSheetImage/"

const DefaultSpriteSheetFrames = {
    frames: {
        "default 0.png": {
            frame: {
                x: 0,
                y: 0,
                w: 24,
                h: 24
            },
            rotated: false,
            trimmed: false,
            sourceSize: {
                w: 24,
                h: 24
            }
        }
    },
    meta: {
        format: "RGBA8888",
        size: {
            w: 24,
            h: 24
        },
        scale: "1",
        image: DefaultImageLocation + "default.png" // The file path to the image
    }
}



export { SpriteSheetData, DefaultSpriteSheetData, ConvexHulls, ConvexHull, DefaultConvexHulls, SpriteSheetImageData, DefaultSpriteSheetImage, SpriteSheetFramesData, DefaultSpriteSheetFrames, FrameInfo, DefaultImageLocation }
