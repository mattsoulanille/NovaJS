import { BaseParse } from "./BaseParse";
import { ShanResource } from "../resourceParsers/ShanResource";
import { Animation, AnimationImagePurposes, AnimationImages } from "novadatainterface/Animation";
import { BaseData } from "../../../NovaDataInterface/BaseData";


async function ShanParse(shan: ShanResource): Promise<Animation> {
    var base: BaseData = await BaseParse(shan);



    var imagePurposes: AnimationImagePurposes = {
        normal: {
            start: 0,
            length: shan.framesPer
        }
    }

    var imageNames = ['baseImage', 'altImage', 'glowImage', 'lightImage', 'weapImage'];
    for (var index in imageNames) {
        var imageName = imageNames[index];
        var imageInfo = shan.images[imageName];


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
                        ((shan.images[imageName].setCount || shan.images.baseImage.setCount) - 1)
                }
                break;
        }
    }
    var rled = shan.idSpace.rlëD[
    
    var images: AnimationImages = {
        id:
            imagePurposes,


    }

}


var base: BaseResource = await super.parse(shan);


var images: {
    [index: string]:
    {
        id: string,
        imagePurposes: ImagePurposes
    }
} = {};


for (let index in imageNames) {
    var imageName = imageNames[index];
    var imageInfo = shan[imageName];

    if (imageInfo.ID <= 0) {
        continue; // Didn't exist
    }

    var imagePurposes: ImagePurposes = {
        normal: {
            start: 0,
            length: shan.framesPer
        }
    };

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
                length: shan.framesPer * ((shan[imageName].setCount || shan.baseImage.setCount) - 1)
            }
            break;
    }


    // get the rled from novadata
    var rled = shan.idSpace['rlëD'][imageInfo.ID];

    images[imageName] = {
        id: rled.globalID,
        imagePurposes: imagePurposes,
    }
}

return {
    exitPoints: shan.exitPoints,
    images,

    ...base

};
    }
}
