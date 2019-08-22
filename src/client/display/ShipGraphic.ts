import * as PIXI from "pixi.js";
import { GameData } from "../GameData";
import { Animation } from "novadatainterface/Animation";
import { NovaDataType } from "novadatainterface/NovaDataInterface";
import { SpriteSheetSprite } from "./SpriteSheetSprite";
import { ShipState } from "../../engine/ShipState";
import { AnimationGraphic } from "./AnimationGraphic";
import { IDGraphic } from "./IDGraphic";


class ShipGraphic extends AnimationGraphic {

    // id is the id for GameData. Not the UUID.
    constructor({ gameData, id }: { gameData: GameData, id: string }) {
        super({ gameData, id });
        this.build();
    }

    protected async getAnimation(): Promise<Animation> {
        const ship = await this.gameData.data.Ship.get(this.id);
        return ship.animation;
    }

    drawState(state: ShipState) {
        this.position.x = state.position.x;
        this.position.y = state.position.y;
        this.rotation = state.rotation;
        if (this.sprites.glowImage) {
            this.sprites.glowImage.alpha = state.accelerating;
        }

        switch (state.turning) {
            case -1:
                this.setFramesToUse("left");
                break;
            case 1:
                this.setFramesToUse("right");
                break;
            default:
                this.setFramesToUse("normal");
                break;
        }

    }
}

export { ShipGraphic }
