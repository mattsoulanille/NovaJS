import { ShipState } from "novajs/nova/src/proto/ship_state_pb";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { Animation } from "../../../../novadatainterface/Animation";
import { Position } from "../../engine/Position";
import { AnimationGraphic } from "./AnimationGraphic";
import { Drawable } from "./Drawable";

class ShipDrawable implements Drawable<ShipState> {
    readonly displayObject = new PIXI.Container();
    private animation?: AnimationGraphic;
    private id?: string;

    // id is the id for GameData. Not the UUID.
    constructor(private readonly gameData: GameDataInterface) { }

    private async getAnimation(id: string): Promise<Animation> {
        const ship = await this.gameData.data.Ship.get(id);
        return ship.animation;
    }

    draw(state: ShipState, center: Position) {
        const spaceObjectState = state.getSpaceobjectstate();

        // TODO: Refactor the data format so animations are first class
        // so you can make a factoryQueueMap of animations that you
        // can quickly pull from.
        const id = state.getId();
        if (this.id !== id || !this.animation) {
            this.animation = new AnimationGraphic({
                gameData: this.gameData,
                animation: this.getAnimation(id)
            });
            this.id = id;
        }

        if (!spaceObjectState) {
            console.warn("State had no SpaceObjectState");
        } else {
            return this.animation.drawSpaceObjectState(spaceObjectState, center);
        }
        return false;
    }
}

export { ShipDrawable };
