import { NovaDataType } from "nova_data_interface/NovaDataInterface";
import { BLEND_MODES } from "nova_data_interface/BlendModes";
import { Animation, AnimationImage, getDefaultAnimationImage, getDefaultExitPoints } from "nova_data_interface/Animation";
import { BaseData } from "nova_data_interface/BaseData";
import { ExplosionData } from "nova_data_interface/ExplosionData";
import { BoomResource } from "../resource_parsers/BoomResource";
import { BaseParse } from "./BaseParse";


export async function ExplosionParse(boom: BoomResource, notFoundFunction: (m: string) => void): Promise<ExplosionData> {
    var base: BaseData = await BaseParse(boom, notFoundFunction);
    var spin = boom.idSpace.spïn[boom.graphic];
    var animationImage: AnimationImage;

    if (spin) {
        var rled = spin.idSpace.rlëD[spin.spriteID]
        if (rled) {
            animationImage = {
                id: rled.globalID,
                dataType: NovaDataType.SpriteSheetImage,
                blendMode: BLEND_MODES.ADD,
                frames: {
                    normal: { start: 0, length: rled.numberOfFrames }
                }
            }
        }
        else {
            notFoundFunction("Missing rled " + spin.spriteID + " for bööm " + base.id);
            animationImage = getDefaultAnimationImage();
        }
    }
    else {
        notFoundFunction("Missing spin " + boom.graphic + " for bööm " + base.id);
        animationImage = getDefaultAnimationImage();
    }


    var animation: Animation = {
        images: {
            baseImage: animationImage
        },
        exitPoints: getDefaultExitPoints(), // Unused. Refactor???
        ...base
    };

    let soundID: string | null = null;
    if (boom.sound) {
        soundID = boom.idSpace["snd "][boom.sound]?.globalID;
        if (!soundID) {
            notFoundFunction("Missing snd " + boom.sound + " for bööm " + base.id);
        }
    }

    return {
        ...base,
        animation,
        sound: soundID,
        rate: boom.animationRate / 100
    }
};
