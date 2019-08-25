import * as PIXI from "pixi.js";
import { GameData } from "../GameData";
import { Animation } from "novadatainterface/Animation";
import { NovaDataType } from "novadatainterface/NovaDataInterface";
import { SpriteSheetSprite } from "./SpriteSheetSprite";
import { ShipState } from "../../engine/ShipState";
import { SpaceObjectState } from "../../engine/SpaceObjectState";
import { VectorLike } from "../../engine/Vector";


abstract class AnimationGraphic extends PIXI.Container {
    protected readonly gameData: GameData;
    public buildPromise!: Promise<void>;
    sprites: { [index: string]: SpriteSheetSprite };
    private _rotation: number;
    readonly id: string;


    constructor({ gameData, id }: { gameData: GameData, id: string }) {
        super();
        this.id = id;
        this.gameData = gameData;
        this.sprites = {};
        this._rotation = 0;
        super.rotation = 0;
        //this.build();

    }

    protected build() {
        this.buildPromise = this.getBuildPromise();
    }

    protected abstract async getAnimation(): Promise<Animation>;

    private async getBuildPromise() {
        const animation = await this.getAnimation();
        var promises: Promise<unknown>[] = [];
        for (let imageName in animation.images) {
            let image = animation.images[imageName];
            let sprite = new SpriteSheetSprite({
                id: image.id,
                imagePurposes: image.imagePurposes,
                gameData: this.gameData
            });

            if (imageName === "glowImage" || // Engine glow
                imageName === "lightImage") { // Lights
                sprite.blendMode = PIXI.BLEND_MODES.ADD;
            }

            this.sprites[imageName] = sprite;
            this.addChild(sprite);
            promises.push(sprite.buildPromise);
        }
        await Promise.all(promises);
        this.rotation = this.rotation;
    }

    setFramesToUse(frames: string) {
        for (let sprite of Object.values(this.sprites)) {
            sprite.setFramesToUse(frames);
        }
    }

    set rotation(angle: number) {
        this._rotation = angle;
        for (let sprite of Object.values(this.sprites)) {
            sprite.rotation = angle;
        }
    }

    get rotation() {
        return this._rotation;
    }

    abstract draw(state: SpaceObjectState, center: VectorLike): void;
}

export { AnimationGraphic }
