import { BaseParse } from "./BaseParse";
import { BaseResource } from "./BaseResource";

type ImagePurposes = { [index: string]: { start: number, length: number } };

class ShanParse extends BaseParse {
    constructor(data: NovaDataInterface) {
        super(data);
    }


    async parse(shan: any): Promise<Animation> {
        var base: BaseResource = await super.parse(shan);
        var imageNames = ['baseImage', 'altImage', 'glowImage', 'lightImage', 'weapImage'];

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
