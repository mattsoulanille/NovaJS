import { BaseData, DefaultBaseData } from "./BaseData";
import * as fs from "fs";
import { Animation, DefaultAnimation } from "./Animation";


interface ExplosionData extends BaseData {
    animation: Animation,
    sound: string // TODO: Implement sound
}

const DefaultExplosionData: ExplosionData = {
    ...DefaultBaseData,
    animation: DefaultAnimation,
    sound: "default" // TODO: Make a sound interface
}

export { ExplosionData, DefaultExplosionData }
