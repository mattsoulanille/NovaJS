import { BaseData, getDefaultBaseData } from "./BaseData";

export type ConvexHull = Array<[number, number]>;

// A box around the origin
export function getDefaultConvexHull(): ConvexHull {
    return [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
    ];
}

export type ConvexHulls = Array<ConvexHull>;

export function getDefaultConvexHulls(): ConvexHulls {
    return [getDefaultConvexHull()];
}

export interface SpriteSheetData extends BaseData {
    convexHulls: Array<ConvexHull>
}


export function getDefaultSpriteSheetData(): SpriteSheetData {
    return {
        ...getDefaultBaseData(),
        convexHulls: getDefaultConvexHulls()
    };
}

export type SpriteSheetImageData = Buffer;

export interface FrameInfo {
    frame: {
        x: number,
        y: number,
        w: number,
        h: number
    };
    rotated: boolean;
    trimmed: boolean;
    sourceSize: {
        w: number,
        h: number
    };
}

export interface SpriteSheetFramesData {
    frames: {
        [index: string]: FrameInfo,
    };
    meta: {
        format: string,
        size: {
            w: number,
            h: number
        },
        scale: string,
        image: string // The file path to the image
    };
}


export const DefaultImageLocation = "../SpriteSheetImage/";

export function getDefaultSpriteSheetFrames(): SpriteSheetFramesData {
    return {
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
}
