import { SpriteSheetImageData, SpriteSheetFramesData, SpriteSheetData } from "../../../../novadatainterface/SpriteSheetData";
import * as PIXI from "pixi.js";
import { GameData } from "../gamedata/GameData";
import { AnimationImagePurposes, AnimationImageIndex } from "../../../../novadatainterface/Animation";

const TWO_PI = 2 * Math.PI;

function mod(a: number, b: number) {
    return ((a % b) + b) % b;
}


class SpriteSheetSprite extends PIXI.Sprite {
    private readonly gameData: GameData;
    private readonly id: string;
    private textures: PIXI.Texture[] | undefined;
    readonly buildPromise: Promise<unknown>
    private readonly imagePurposes: AnimationImagePurposes;
    private textureSet: AnimationImageIndex;
    private _rotation: number;


    constructor({ id, gameData, imagePurposes }: { id: string, gameData: GameData, imagePurposes: AnimationImagePurposes }) {
        super();
        this.gameData = gameData
        this.id = id;
        this.imagePurposes = imagePurposes;
        this.textureSet = imagePurposes.normal;
        this._rotation = 0;

        const loadTextures = async () => {
            this.textures = await this.gameData.texturesFromSpriteSheet(this.id)
        }
        this.anchor.x = 0.5;
        this.anchor.y = 0.5;
        this.buildPromise = loadTextures();
    }

    private setTexture(index: number) {
        if (this.textures) {
            if (index < this.textures.length) {
                this.texture = this.textures[index];
            }
            else {
                console.warn("Requested texture index " + index
                    + " but there are only " + this.textures.length);
            }
        }
    }

    setFramesToUse(frames: string) {
        if (frames in this.imagePurposes) {
            this.textureSet = this.imagePurposes[frames];
        }
    }

    private getAngleAndPartition(angle: number, resolution: number) {

        const index = mod(
            Math.round((angle / TWO_PI) * resolution),
            resolution
        );

        const partitionAngle = index * TWO_PI / resolution;
        const localAngle = angle - partitionAngle;

        return {
            index: index,
            angle: localAngle
        };
    }

    set rotation(angle: number) {
        // Divide rotation equally among the available rotation textures
        angle = mod(angle, TWO_PI);
        const count = this.textureSet.length;

        // Center the textures around the rotations they
        // best represent instead of having them offset to the right.

        let r = this.getAngleAndPartition(angle, count);
        const textureSetLocalIndex = r.index;
        const textureSetGlobalIndex = textureSetLocalIndex + this.textureSet.start;

        if (this.textures) {
            this.setTexture(textureSetGlobalIndex);

        }

        super.rotation = r.angle;
        this._rotation = angle;
    }

    get rotation() {
        return this._rotation;
    }

}

export { SpriteSheetSprite }
