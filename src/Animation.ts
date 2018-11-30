import { BaseData, DefaultBaseData } from "./BaseData";


type AnimationImageIndex = { start: number, length: number }

const DefaultAnimationImageIndex = { start: 0, length: 1 }

type AnimationImagePurposes = {
    [index: string]: AnimationImageIndex,
    normal: AnimationImageIndex
}


const DefaultAnimationImagePurposes: AnimationImagePurposes = {
    normal: { start: 0, length: 1 }
}

type AnimationImage = {
    id: string,
    imagePurposes: AnimationImagePurposes
}

const DefaultAnimationImage: AnimationImage = {
    id: "default",
    imagePurposes: DefaultAnimationImagePurposes
}

type AnimationImages = {
    [index: string]: AnimationImage,
    baseImage: AnimationImage
}

type ExitPoint = Array<Array<number>>;
type ExitPoints = {
    gun: ExitPoint,
    turret: ExitPoint,
    guided: ExitPoint,
    beam: ExitPoint,
    upCompress: Array<number>,
    downCompress: Array<number>
};

var DefaultExitPoints: ExitPoints = {
    gun: [],
    turret: [],
    guided: [],
    beam: [],
    upCompress: [],
    downCompress: []
}

// This probably actually shouldn't extend BaseData
interface Animation extends BaseData {
    images: AnimationImages;
    exitPoints: ExitPoints;
}

const DefaultAnimation: Animation = {
    images: {
        baseImage: DefaultAnimationImage
    },
    exitPoints: DefaultExitPoints,
    ...DefaultBaseData
}


export { Animation, DefaultAnimation, AnimationImages, AnimationImagePurposes, ExitPoints, ExitPoint, DefaultExitPoints, DefaultAnimationImage, AnimationImage };
