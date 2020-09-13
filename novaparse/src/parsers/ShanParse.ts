import { Animation, AnimationFrames, AnimationImages, getDefaultAnimationImage } from "novajs/novadatainterface/Animation";
import { BaseData } from "novajs/novadatainterface/BaseData";
import { NovaDataType } from "novajs/novadatainterface/NovaDataInterface";
import { NovaIDNotFoundError } from "novajs/novadatainterface/NovaDataInterface";
import { BLEND_MODES } from "novajs/novadatainterface/BlendModes";
import { ShanResource } from "../resource_parsers/ShanResource";
import { BaseParse } from "./BaseParse";


export async function ShanParse(shan: ShanResource, notFoundFunction: (message: string) => void): Promise<Animation> {
    var base: BaseData = await BaseParse(shan, notFoundFunction);

    var images: AnimationImages = {
        baseImage: getDefaultAnimationImage()
    };

    for (const [imageName, imageInfo] of Object.entries(shan.images)) {
        if (!imageInfo) {
            continue; // That image does not exist for this Shan
        }

        var frames: AnimationFrames = {
            normal: {
                start: 0,
                length: shan.framesPer
            }
        }

        let blendMode = BLEND_MODES.NORMAL;
        if (imageName === "lightImage"
            || imageName === "glowImage"
            || imageName === "weapImage") {
            blendMode = BLEND_MODES.ADD;
        }

        switch (shan.flags.extraFramePurpose) {
            case ('banking'):
                frames.left = {
                    start: shan.framesPer,
                    length: shan.framesPer,
                }
                frames.right = {
                    start: shan.framesPer * 2,
                    length: shan.framesPer
                };
                break;
            case ('animation'):
                frames.animation = {
                    start: shan.framesPer,
                    // The rest of the frames are for the animation
                    length: shan.framesPer *
                        ((imageInfo.setCount || shan.images.baseImage.setCount) - 1)
                }
                break;
        }


        // get the rled from novadata
        // The rled contains the ID of the image that is used.
        var rled = shan.idSpace.rlëD[imageInfo.ID];
        if (!rled) {
            notFoundFunction(`shän id ${base.id} has no corresponding`
                + ` rlëD for ${imageName}, which expects`
                + ` rlëD id ${imageInfo.ID} to be available.`);

            if (imageName == "baseImage") { // Everything must have a baseImage.
                throw new NovaIDNotFoundError("Base image not found for rlëD id " + imageInfo.ID);
            }

            continue; // Don't add this as an image since it wasn't found. 
        }

        // Store the image in images
        images[imageName] = {
            id: rled.globalID,
            dataType: NovaDataType.SpriteSheetImage,
            blendMode,
            frames,
        };
    }

    return {
        ...base,
        images,
        exitPoints: shan.exitPoints
    }
}
