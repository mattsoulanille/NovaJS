import { Animation } from "../../../../novadatainterface/Animation";
import { Position } from "../../engine/space_object/Position";
import { MainDrawable } from "./MainDrawable";
import { SpaceObjectView } from "../../engine/TreeView";

export class ShipDrawable extends MainDrawable<SpaceObjectView> {

    protected async getAnimation(id: string): Promise<Animation> {
        const ship = await this.gameData.data.Ship.get(id);
        return ship.animation;
    }

    draw(state: SpaceObjectView, center: Position) {

        this.maybeUpdateId(state.getId());
        return this.drawSpaceObject(spaceObjectState, center);
    }
}
