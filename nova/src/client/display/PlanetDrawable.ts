import { PlanetState } from "novajs/nova/src/proto/planet_state_pb";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { AnimationGraphic } from "./AnimationGraphic";
import { Drawable } from "./Drawable";
import { Position } from "../../engine/Position";

class PlanetDrawable implements Drawable<PlanetState> {

    readonly displayObject: AnimationGraphic;
    private gameData: GameDataInterface;
    readonly id: string;
    readonly buildPromise: Promise<PlanetDrawable>;

    constructor({ gameData, id }: { gameData: GameDataInterface, id: string }) {
        this.gameData = gameData;
        this.id = id;
        this.displayObject = new AnimationGraphic({
            gameData: this.gameData,
            animation: this.getAnimation()
        });
        this.buildPromise = this.getBuildPromise()
    }

    private async getBuildPromise() {
        await this.displayObject.buildPromise;
        return this;
    }

    async getAnimation() {
        const planet = await this.gameData.data.Planet.get(this.id);
        return planet.animation;
    }

    draw(state: PlanetState, center: Position) {
        const spaceObjectState = state.getSpaceobjectstate();
        if (spaceObjectState) {
            console.warn("State had no SpaceObjectState");
            return this.displayObject.drawSpaceObjectState(spaceObjectState, center);
        }
        return false;
    }

    static getFactory(gameData: GameDataInterface) {
        return (id: string) => {
            return new PlanetDrawable({ gameData, id }).buildPromise;
        }
    }
}

export { PlanetDrawable };
