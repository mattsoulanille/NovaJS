import { AnimationGraphic } from "./AnimationGraphic";
import { PlanetState } from "../../engine/PlanetState";
import { GameData } from "../GameData";

class PlanetGraphic extends AnimationGraphic {

    constructor({ gameData, id }: { gameData: GameData, id: string }) {
        super({ gameData, id });
        this.build();
    }

    protected async getAnimation() {
        const planet = await this.gameData.data.Planet.get(this.id);
        return planet.animation;
    }

    drawState(state: PlanetState) {
        this.position.x = state.position.x;
        this.position.y = state.position.y;
    }
}

export { PlanetGraphic }
