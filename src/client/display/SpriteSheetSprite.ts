import { SpriteSheetImageData, SpriteSheetFramesData, SpriteSheetData } from "novadatainterface/SpriteSheetData";
import * as PIXI from "pixi.js";
import { GameData } from "../GameData";
import { AnimationImagePurposes, AnimationImageIndex } from "novadatainterface/Animation";

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

    set rotation(angle: number) {
        // Divide rotation equally among the available rotation textures
        const count = this.textureSet.length;
        const partitionSize = TWO_PI / count;

        // Center the textures around the rotations they
        // best represent instead of having them offset to the right.
        const centeredAngle = mod(angle + partitionSize / 2, TWO_PI);

        const textureSetLocalIndex = Math.floor(centeredAngle / partitionSize);
        const textureSetGlobalIndex = textureSetLocalIndex + this.textureSet.start;

        if (this.textures) {
            this.setTexture(textureSetGlobalIndex);

        }

        super.rotation = mod(centeredAngle, partitionSize);
        this._rotation = mod(angle, TWO_PI);
    }

    get rotation() {
        return this._rotation;
    }

}

export { SpriteSheetSprite }
