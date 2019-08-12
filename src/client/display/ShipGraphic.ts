import * as PIXI from "pixi.js";
import { GameData } from "../GameData";
import { Animation } from "novadatainterface/Animation";
import { NovaDataType } from "novadatainterface/NovaDataInterface";
import { SpriteSheetSprite } from "./SpriteSheetSprite";
import { ShipState } from "../../engine/ShipState";


class ShipGraphic extends PIXI.Container {
    private readonly gameData: GameData;
    id: string;
    buildPromise: Promise<void>;
    sprites: SpriteSheetSprite[];
    private _rotation: number;


    // id is the id for GameData. Not the UUID.
    constructor({ gameData, id }: { gameData: GameData, id: string }) {
        super();
        this.visible = false;
        this.gameData = gameData;
        this.id = id;
        this.sprites = [];
        this._rotation = 0;
        super.rotation = 0;

        this.buildPromise = this.build();
    }

    private async build() {
        var data = await this.gameData.data.Ship.get(this.id);
        var promises: Promise<unknown>[] = [];
        for (let imageName in data.animation.images) {
            let image = data.animation.images[imageName];
            let sprite = new SpriteSheetSprite({
                id: image.id,
                imagePurposes: image.imagePurposes,
                gameData: this.gameData
            });

            if (imageName === "glowImage" || // Engine glow
                imageName === "lightImage") { // Lights
                sprite.blendMode = PIXI.BLEND_MODES.ADD;
            }

            this.sprites.push(sprite);
            this.addChild(sprite);
            promises.push(sprite.buildPromise);
        }
        await Promise.all(promises);
        this.rotation = this.rotation;
    }

    setFramesToUse(frames: string) {
        for (let sprite of this.sprites) {
            sprite.setFramesToUse(frames);
        }
    }

    set rotation(angle: number) {
        this._rotation = angle;
        for (let sprite of this.sprites) {
            sprite.rotation = angle;
        }
    }

    get rotation() {
        return this._rotation;
    }

    drawState(state: ShipState) {
        this.position.x = state.position.x;
        this.position.y = state.position.y;
        this.rotation = state.rotation;

    }
}

export { ShipGraphic }
