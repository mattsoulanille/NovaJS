import { BaseData, getDefaultBaseData } from "./BaseData";


export interface AnimationImageIndex {
    start: number;
    length: number;
}

export function getDefaultAnimationImageIndex() {
    return { start: 0, length: 1 };
}

export type AnimationImagePurposes = {
    [index: string]: AnimationImageIndex,
    normal: AnimationImageIndex
}

export function getDefaultAnimationImagePurposes(): AnimationImagePurposes {
    return {
        normal: getDefaultAnimationImageIndex()
    };
}

export interface AnimationImage {
    id: string;
    imagePurposes: AnimationImagePurposes;
}

export function getDefaultAnimationImage(): AnimationImage {
    return {
        id: "default",
        imagePurposes: getDefaultAnimationImagePurposes()
    };
}

export type AnimationImages = {
    [index: string]: AnimationImage,
    baseImage: AnimationImage
}

export type ExitPoint = Array<Array<number>>;
export interface ExitPoints {
    gun: ExitPoint;
    turret: ExitPoint;
    guided: ExitPoint;
    beam: ExitPoint;
    upCompress: Array<number>;
    downCompress: Array<number>;
};

export function getDefaultExitPoints(): ExitPoints {
    return {
        gun: [],
        turret: [],
        guided: [],
        beam: [],
        upCompress: [],
        downCompress: []
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
