import { PlanetState } from "../../engine/PlanetState";
import { GameData } from "../gamedata/GameData";
import { VectorLike } from "../../engine/Vector";
import { SpaceObjectGraphic } from "./SpaceObjectGraphic";

class PlanetGraphic extends SpaceObjectGraphic {

    constructor({ gameData, id }: { gameData: GameData, id: string }) {
        super({ gameData, id });
        this.build();
    }

    protected async getAnimation() {
        const planet = await this.gameData.data.Planet.get(this.id);
        return planet.animation;
    }
}

export { PlanetGraphic }
