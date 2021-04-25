import { BLEND_MODES } from "./BlendModes";
import { BaseData, getDefaultBaseData } from "./BaseData";
import { NovaDataType } from "./NovaDataInterface";


export interface AnimationImageIndex {
    start: number;
    length: number;
}

export function getDefaultAnimationImageIndex() {
    return { start: 0, length: 1 };
}

export type AnimationFrames = {
    [index: string]: AnimationImageIndex,
    normal: AnimationImageIndex
}

export function getDefaultAnimationFrames(): AnimationFrames {
    return {
        normal: getDefaultAnimationImageIndex()
    };
}

export interface AnimationImage {
    id: string;
    // TODO: Add a datatype for using picts here.
    dataType: NovaDataType.SpriteSheetImage;
    blendMode: BLEND_MODES;
    frames: AnimationFrames;
}

export function getDefaultAnimationImage(): AnimationImage {
    return {
        id: "default",
        dataType: NovaDataType.SpriteSheetImage,
        blendMode: BLEND_MODES.NORMAL,
        frames: getDefaultAnimationFrames()
    };
}

export type AnimationImages = {
    [index: string]: AnimationImage,
    baseImage: AnimationImage
}

export type ExitPoint = Array<[number, number, number]>;
export interface ExitPoints {
    gun: ExitPoint;
    turret: ExitPoint;
    guided: ExitPoint;
    beam: ExitPoint;
    upCompress: [number, number];
    downCompress: [number, number];
};

export function getDefaultExitPoints(): ExitPoints {
    return {
        gun: [],
        turret: [],
        guided: [],
        beam: [],
        upCompress: [0, 0],
        downCompress: [0, 0]
    }
}

// This probably actually shouldn't extend BaseData
export interface Animation extends BaseData {
    images: AnimationImages;
    exitPoints: ExitPoints;
}

export function getDefaultAnimation(): Animation {
    return {
        images: {
            baseImage: getDefaultAnimationImage()
        },
        exitPoints: getDefaultExitPoints(),
        ...getDefaultBaseData()
    }
}
