import { PlanetState } from "novajs/nova/src/proto/planet_state_pb";
import { Position } from "../../engine/Position";
import { MainDrawable } from "./MainDrawable";

export class PlanetDrawable extends MainDrawable<PlanetState> {

    protected async getAnimation(id: string) {
        const planet = await this.gameData.data.Planet.get(id);
        return planet.animation;
    }

    draw(state: PlanetState, center: Position) {
        const spaceObjectState = state.getSpaceobjectstate();

        this.maybeUpdateId(state.getId());
        return this.drawSpaceObject(spaceObjectState, center);
    }
}
