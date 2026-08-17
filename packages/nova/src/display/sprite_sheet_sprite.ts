import { AnimationImage } from "novadatainterface/animation";
import * as PIXI from "pixi.js";
import { AnimationImageIndex } from "novadatainterface/animation";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { texturesFromFrames } from "./textures_from_frames.js";
import { mod } from "../util/mod.js";
import { getFrameAndAngle } from "../util/get_frame_and_angle.js";


const TWO_PI = 2 * Math.PI;

export class SpriteSheetSprite {
    readonly pixiSprite = new PIXI.Sprite();
    private readonly displayAssets: DisplayAssetDataInterface;
    private readonly image: AnimationImage;
    private textures?: PIXI.Texture[];
    frames: number = 0;
    readonly buildPromise: Promise<SpriteSheetSprite>;
    private textureSet: AnimationImageIndex;
    private wrappedRotation: number;
    private wrappedFrame: number = 0;
    size = { x: 0, y: 0 };

    constructor({ displayAssets, image }: { displayAssets: DisplayAssetDataInterface, image: AnimationImage }) {
        this.displayAssets = displayAssets;
        this.image = image;
        this.textureSet = this.image.frames.normal;
        this.wrappedRotation = 0;
        this.pixiSprite.blendMode = image.blendMode;

        const loadTextures = async () => {
            const framesData = await this.displayAssets.data
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

    /**
     * How many full `framesPer`-frame rotation sets this sprite sheet holds
     * (its BaseSetCount / AltSetCount). At least 1 while textures are still
     * loading (this.frames === 0).
     */
    setCountForFramesPer(framesPer: number): number {
        return framesPer > 0 ? Math.max(1, Math.floor(this.frames / framesPer)) : 1;
    }

    /**
     * Selects base sprite set `setIndex` (clamped to what the sheet holds)
     * as the active rotation set and recomputes the displayed frame from the
     * current heading. This is how the ship base-set animation (continuous
     * spin, folding wings, the alt-image overlay) composes with rotation:
     * the animation picks the SET, the heading picks the frame within it.
     */
    selectBaseSet(setIndex: number, framesPer: number) {
        if (!this.textures || framesPer <= 0) {
            return;
        }
        const sets = this.setCountForFramesPer(framesPer);
        const clamped = Math.max(0, Math.min(sets - 1, Math.floor(setIndex)));
        this.textureSet = { start: clamped * framesPer, length: framesPer };
        // Re-apply the stored heading so the frame recomputes within the set.
        this.rotation = this.wrappedRotation;
    }

    /**
     * The active texture set's absolute frame range, i.e. which slice of
     * the sheet `rotation` currently spreads the headings over. Callers
     * that drive the frame themselves (a spinning shot's animation cycle,
     * ProjectileSpinSystem) need it to stay inside the active set rather
     * than assuming the set is the whole sheet. A copy, since the backing
     * object is shared game data.
     */
    get frameRange(): { start: number, length: number } {
        return { start: this.textureSet.start, length: this.textureSet.length };
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

    static getFactory(displayAssets: DisplayAssetDataInterface) {
        return (image: AnimationImage) => {
            return new SpriteSheetSprite({ displayAssets, image }).buildPromise;
        }
    }
}
