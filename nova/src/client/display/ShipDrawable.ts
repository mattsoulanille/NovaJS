import { ShipState } from "novajs/nova/src/proto/ship_state_pb";
import { Animation } from "../../../../novadatainterface/Animation";
import { Position } from "../../engine/Position";
import { MainDrawable } from "./MainDrawable";

export class ShipDrawable extends MainDrawable<ShipState> {

    protected async getAnimation(id: string): Promise<Animation> {
        const ship = await this.gameData.data.Ship.get(id);
        return ship.animation;
    }

    draw(state: ShipState, center: Position) {
        const spaceObjectState = state.getSpaceobjectstate();

        this.maybeUpdateId(state.getId());
        return this.drawSpaceObject(spaceObjectState, center);
    }
}
