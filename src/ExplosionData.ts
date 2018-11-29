import { BaseData, DefaultBaseData } from "./BaseData";
import * as fs from "fs";
import { Animation, DefaultAnimation } from "./Animation";


interface ExplosionData extends BaseData {
    animation: Animation,
    sound: string | null // TODO: Implement sound
}

const DefaultExplosionData: ExplosionData = {
    ...DefaultBaseData,
    animation: DefaultAnimation,
    sound: null // TODO: Make a sound interface
}

export { ExplosionData, DefaultExplosionData }
