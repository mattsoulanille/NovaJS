import { BaseParse } from "./BaseParse";
import { ShanResource } from "../resourceParsers/ShanResource";
import { Animation, AnimationImagePurposes, AnimationImages } from "novadatainterface/Animation";
import { BaseData } from "novadatainterface/BaseData";




async function ShanParse(shan: ShanResource): Promise<Animation> {
    var base: BaseData = await BaseParse(shan);

    var images: AnimationImages = {};

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
        var rled = shan.idSpace.rlëD[imageInfo.ID];

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
