
import { ExplosionData } from "novadatainterface/ExplosionData";
import { BoomResource } from "../resourceParsers/BoomResource";
import { BaseData } from "novadatainterface/BaseData";
import { BaseParse } from "./BaseParse";
import { Animation, DefaultExitPoints, AnimationImage, DefaultAnimationImage } from "novadatainterface/Animation";

async function ExplosionParse(boom: BoomResource, notFoundFunction: (m: string) => void): Promise<ExplosionData> {
    var base: BaseData = await BaseParse(boom, notFoundFunction);


    var spin = boom.idSpace.spïn[boom.graphic];
    var animationImage: AnimationImage;

    if (spin) {
        var rled = spin.idSpace.rlëD[spin.spriteID]
        if (rled) {
            animationImage = {
                id: rled.globalID,
                imagePurposes: {
                    normal: { start: 0, length: rled.numberOfFrames }
                }
            }
        }
        else {
            notFoundFunction("Missing rled " + spin.spriteID + " for bööm " + base.id);
            animationImage = DefaultAnimationImage
        }
    }
    else {
        notFoundFunction("Missing spin " + boom.graphic + " for bööm " + base.id);
        animationImage = DefaultAnimationImage
    }


    var animation: Animation = {
        images: {
            baseImage: animationImage
        },
        exitPoints: DefaultExitPoints, // Unused. Refactor???
        ...base
    };



    var soundID: string | null = null;
    /*
    // Sound parsing is broken for some reason
    if (boom.sound) {
        let sound = boom.idSpace["snd "][boom.sound];
        if (sound) {
            soundID = sound.globalID;
        }
        else {
            notFoundFunction("Missing snd " + boom.sound + " for bööm " + base.id);
        }
    }
    */


    return {
        ...base,
        animation,
        sound: soundID,
        rate: boom.animationRate / 100
    }
};

export { ExplosionParse };
