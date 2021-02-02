import { Animation, getDefaultAnimation } from "./Animation";
import { BaseData, getDefaultBaseData } from "./BaseData";


export interface ExplosionData extends BaseData {
    animation: Animation,
    sound: string | null, // TODO: Implement sound
    rate: number // speed factor for animation
}


export function getDefaultExplosionData(): ExplosionData {
    return {
        ...getDefaultBaseData(),
        animation: getDefaultAnimation(),
        sound: null, // TODO: Make a sound interface
        rate: 1
    }
}
