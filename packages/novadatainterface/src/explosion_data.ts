import { Animation, getDefaultAnimation } from "./animation.js";
import { BaseData, getDefaultBaseData } from "./base_data.js";


export interface ExplosionData extends BaseData {
    animation: Animation,
    /** Global "snd " id played when the explosion spawns, or null. */
    sound: string | null,
    /**
     * Animation speed in sprite frames per GAME frame, where a game
     * frame is 1/30 s: bööm FrameAdvance / 100. EVN Bible (bööm): "100
     * will cause each frame of the explosion to appear for exactly one
     * frame of the game animation", so at rate 1 each sprite frame lasts
     * 1000/30 ms; 0.5 holds each for two game frames (66.7 ms).
     */
    rate: number
}


export function getDefaultExplosionData(): ExplosionData {
    return {
        ...getDefaultBaseData(),
        animation: getDefaultAnimation(),
        sound: null,
        rate: 1
    }
}
