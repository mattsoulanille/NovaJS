import { Animation } from "novadatainterface/Animation";
import { ShipState } from "../../engine/ShipState";
import { VectorLike } from "../../engine/Vector";
import { GameData } from "../GameData";
import { SpaceObjectGraphic } from "./SpaceObjectGraphic";


class ShipGraphic extends SpaceObjectGraphic {

    // id is the id for GameData. Not the UUID.
    constructor({ gameData, id }: { gameData: GameData, id: string }) {
        super({ gameData, id });
        this.build();
    }

    protected async getAnimation(): Promise<Animation> {
        const ship = await this.gameData.data.Ship.get(this.id);
        return ship.animation;
    }

    draw(state: ShipState, center: VectorLike) {
        super.draw(state, center);

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

export { ShipGraphic };
