import { NovaDataType } from "novadatainterface/nova_data_interface";
import { BLEND_MODES } from "novadatainterface/blend_modes";
import { Animation, AnimationImage, getDefaultAnimationImage, getDefaultExitPoints } from "novadatainterface/animation";
import { BaseData } from "novadatainterface/base_data";
import { ExplosionData } from "novadatainterface/explosion_data";
import { BoomResource } from "../resource_parsers/boom_resource.js";
import { BaseParse } from "./base_parse.js";


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
        blink: null, // Explosions have no running lights.
        animationMode: null, // Explosions have no shän extra-frame animation.
        weapDecay: 0, // No weapon overlay outside shän ships.
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
        // bööm FrameAdvance, normalised so 1 = "each frame of the
        // explosion appears for exactly one frame of the game animation"
        // (EVN Bible, bööm: FrameAdvance 100). See ExplosionData.rate for
        // the unit — sprite frames per 1/30 s game frame.
        rate: boom.animationRate / 100
    }
};
