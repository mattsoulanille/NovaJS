import { AnimationImage } from "novadatainterface/Animation";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import * as PIXI from "pixi.js";
import { AnimationImageIndex } from "novadatainterface/Animation";
import { texturesFromFrames } from "./textures_from_frames";

export function mod(a: number, b: number): number {
    return ((a % b) + b) % b;
}

const TWO_PI = 2 * Math.PI;

export class SpriteSheetSprite {
    readonly pixiSprite = new PIXI.Sprite();
    private readonly gameData: GameDataInterface;
    private readonly image: AnimationImage;
    private textures: PIXI.Texture[] | undefined;
    readonly buildPromise: Promise<SpriteSheetSprite>;
    private textureSet: AnimationImageIndex;
    private wrappedRotation: number;

    constructor({ gameData, image }: { gameData: GameDataInterface, image: AnimationImage }) {
        this.gameData = gameData;
        this.image = image;
        this.textureSet = this.image.frames.normal;
        this.wrappedRotation = 0;
        this.pixiSprite.blendMode = image.blendMode;

        const loadTextures = async () => {
            const framesData = await this.gameData.data
                .SpriteSheetFrames.get(this.image.id);
            this.textures = await texturesFromFrames(framesData.frames);
            return this;
        }

        this.pixiSprite.anchor.x = 0.5;
        this.pixiSprite.anchor.y = 0.5;
        this.buildPromise = loadTextures();
    }

    private setTexture(index: number) {
        if (this.textures) {
            if (index < this.textures.length) {
                this.pixiSprite.texture = this.textures[index];
            }
            else {
                console.warn("Requested texture index " + index
                    + " but there are only " + this.textures.length);
            }
        }
    }

    setFramesToUse(frames: string) {
        if (frames in this.image.frames) {
            this.textureSet = this.image.frames[frames];
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

        this.pixiSprite.rotation = r.angle;
        this.wrappedRotation = angle;
    }

    get rotation() {
        return this.wrappedRotation;
    }

    static getFactory(gameData: GameDataInterface) {
        return (image: AnimationImage) => {
            return new SpriteSheetSprite({ gameData, image }).buildPromise;
        }
    }
}
