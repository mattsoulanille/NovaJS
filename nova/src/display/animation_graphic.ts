import { GameDataInterface } from "novadatainterface/GameDataInterface";
import * as PIXI from "pixi.js";
import { Animation } from "novadatainterface/Animation";
import { SpriteSheetSprite } from "./sprite_sheet_sprite";

/**
 * An AnimationGraphic is responsible for managing all the PIXI Sprites
 * needed to draw a single animation, be it a ship, explosion, asteroid,
 * or planet.
 */
export class AnimationGraphic {
    // AnimationGraphic is not a Drawable since it doesn't draw a state.
    readonly container = new PIXI.Container();
    protected readonly gameData: GameDataInterface;

    readonly sprites = new Map<string, SpriteSheetSprite>();
    private wrappedRotation = 0;
    private animation: Animation | Promise<Animation>;
    readonly buildPromise: Promise<AnimationGraphic>;
    built = false;
    size = { x: 0, y: 0 }

    constructor({ gameData, animation }: { gameData: GameDataInterface, animation: Animation | Promise<Animation> }) {
        this.animation = animation;
        this.gameData = gameData;
        this.rotation = 0;
        this.buildPromise = this.build();
    }

    private async build(): Promise<AnimationGraphic> {
        var promises: Promise<unknown>[] = [];
        for (const imageName in (await this.animation).images) {
            const image = (await this.animation).images[imageName];
            const sprite = new SpriteSheetSprite({
                image,
                gameData: this.gameData
            });

            this.sprites.set(imageName, sprite);
            this.container.addChild(sprite.pixiSprite);
            promises.push(sprite.buildPromise);
        }
        await Promise.all(promises);
        this.size.x = Math.max(0, ...[...this.sprites.values()].map(s => s.size.x));
        this.size.y = Math.max(0, ...[...this.sprites.values()].map(s => s.size.y));
        this.rotation = this.rotation;
        this.built = true;
        return this;
    }

    set glowAlpha(alpha: number) {
        const glowImage = this.sprites.get('glowImage');
        if (glowImage) {
            glowImage.pixiSprite.alpha = alpha;
        }
    }

    setFramesToUse(frames: string) {
        for (const sprite of this.sprites.values()) {
            sprite.setFramesToUse(frames);
        }
    }

    set rotation(angle: number) {
        this.wrappedRotation = angle;
        for (const sprite of this.sprites.values()) {
            sprite.rotation = angle;
        }
    }

    get rotation() {
        return this.wrappedRotation;
    }
}
