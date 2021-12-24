import { AnimationImage } from "nova_data_interface/Animation";
import { GameDataInterface } from "nova_data_interface/GameDataInterface";
import * as PIXI from "pixi.js";
import { AnimationImageIndex } from "nova_data_interface/Animation";
import { texturesFromFrames } from "./textures_from_frames";
import { mod } from "../util/mod";
import { getFrameAndAngle } from "../util/get_frame_and_angle";


const TWO_PI = 2 * Math.PI;

export class SpriteSheetSprite {
    readonly pixiSprite = new PIXI.Sprite();
    private readonly gameData: GameDataInterface;
    private readonly image: AnimationImage;
    private textures?: PIXI.Texture[];
    frames: number = 0;
    readonly buildPromise: Promise<SpriteSheetSprite>;
    private textureSet: AnimationImageIndex;
    private wrappedRotation: number;
    private wrappedFrame: number = 0;
    size = { x: 0, y: 0 };

    constructor({ gameData, image }: { gameData: GameDataInterface, image: AnimationImage }) {
        this.gameData = gameData;
        this.image = image;
        this.textureSet = this.image.frames.normal;
        this.wrappedRotation = 0;
        this.pixiSprite.blendMode = image.blendMode;

        const loadTextures = async () => {
            const framesData = await this.gameData.data
                .SpriteSheetFrames.get(this.image.id);
            this.textures = texturesFromFrames(framesData.frames);
            this.size.x = Math.max(0, ...this.textures.map(t => t.width));
            this.size.y = Math.max(0, ...this.textures.map(t => t.height));
            this.frames = this.textures.length;
            return this;
        }

        this.pixiSprite.anchor.x = 0.5;
        this.pixiSprite.anchor.y = 0.5;
        this.buildPromise = loadTextures();
    }

    setFramesToUse(frames: string) {
        if (frames in this.image.frames) {
            this.textureSet = this.image.frames[frames];
        }
    }

    get frame() {
        return this.wrappedFrame;
    }

    set frame(frame: number) {
        if (!this.textures) {
            return;
        }
        if (frame < 0 || frame >= this.textures.length) {
            //console.warn(`Frame out of range [0, ${this.textures.length})`);
            return;
        }
        if (frame % 1 !== 0) {
            console.warn('frame must be an integer');
            return;
        }

        this.wrappedFrame = frame;
        this.pixiSprite.texture = this.textures[frame];
    }

    set rotation(angle: number) {
        if (!this.textures) {
            return;
        }
        // Divide rotation equally among the available rotation textures
        angle = mod(angle, TWO_PI);
        const count = this.textureSet.length;

        // Center the textures around the rotations they
        // best represent instead of having them offset to the right.
        let r = getFrameAndAngle(angle, count);
        const textureSetLocalIndex = r.frame;
        this.frame = textureSetLocalIndex + this.textureSet.start;
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
