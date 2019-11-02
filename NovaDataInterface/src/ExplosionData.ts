import { BaseData, DefaultBaseData } from "./BaseData";
import * as fs from "fs";
import { Animation, DefaultAnimation } from "./Animation";


interface ExplosionData extends BaseData {
    animation: Animation,
    sound: string | null, // TODO: Implement sound
    rate: number // speed factor for animation
}

const DefaultExplosionData: ExplosionData = {
    ...DefaultBaseData,
    animation: DefaultAnimation,
    sound: null, // TODO: Make a sound interface
    rate: 1
}

export { ExplosionData, DefaultExplosionData }
