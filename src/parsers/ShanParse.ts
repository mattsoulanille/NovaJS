import { BaseParse } from "./BaseParse";
import { ShanResource } from "../resourceParsers/ShanResource";
import { Animation, AnimationImagePurposes, AnimationImages, DefaultAnimation, DefaultAnimationImage } from "novadatainterface/Animation";
import { BaseData } from "novadatainterface/BaseData";
import { NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";


async function ShanParse(shan: ShanResource, notFoundFunction: (message: string) => void): Promise<Animation> {
    var base: BaseData = await BaseParse(shan, notFoundFunction);

    var images: AnimationImages = {
        baseImage: DefaultAnimationImage
    };

    var imageNames = ['baseImage', 'altImage', 'glowImage', 'lightImage', 'weapImage'];
    for (var index in imageNames) {
        var imageName = imageNames[index];
        var imageInfo = shan.images[imageName];

        if (imageInfo === null) {
            continue; // That image does not exist for this Shan
        }

        var imagePurposes: AnimationImagePurposes = {
            normal: {
                start: 0,
                length: shan.framesPer
            }
        }

        switch (shan.flags.extraFramePurpose) {
            case ('banking'):
                imagePurposes.left = {
                    start: shan.framesPer,
                    length: shan.framesPer,
                }
                imagePurposes.right = {
                    start: shan.framesPer * 2,
                    length: shan.framesPer
                };
                break;
            case ('animation'):
                imagePurposes.animation = {
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
            notFoundFunction("shän id " + base.id + " has no corresponding rlëD for " + imageName
                + ", which expects rlëD id " + imageInfo.ID + " to be available.");

            if (imageName == "baseImage") { // Everything must have a baseImage.
                throw new NovaIDNotFoundError("Base image not found for rlëD id " + imageInfo.ID);
            }

            continue; // Don't add this as an image since it wasn't found. 
        }

        // Store the image in images
        images[imageName] = {
            id: rled.globalID,
            imagePurposes
        }

    }

    return {
        ...base,
        images,
        exitPoints: shan.exitPoints
    }

}

export { ShanParse };
