import { BaseData, DefaultBaseData } from "./BaseData";


type AnimationImagePurposes = {
    [index: string]: { start: number, length: number }
}

type AnimationImages = {
    [index: string]: {
        id: string,
        imagePurposes: AnimationImagePurposes
    }
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

interface Animation extends BaseData {
    images: {
        [index: string]: {
            id: string,
            imagePurposes: { [index: string]: { start: number, length: number } }
        }
    };
    exitPoints: ExitPoints;
}

const DefaultAnimation: Animation = {
    images: {

    },
    exitPoints: DefaultExitPoints,
    ...DefaultBaseData
}


export { Animation, DefaultAnimation, AnimationImages, AnimationImagePurposes, ExitPoints, ExitPoint };
