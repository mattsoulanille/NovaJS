import { FactoryQueueMap } from "../../common/FactoryQueueMap";
import { Position } from "../../engine/Position";
import { SpaceObjectState } from "../../engine/SpaceObjectState";
import { GameData } from "../GameData";
import { AnimationGraphic } from "./AnimationGraphic";
import { IDGraphic } from "./IDGraphic";

class ObjectDrawer<State extends SpaceObjectState, Graphic extends AnimationGraphic> extends PIXI.Container {
    private onScreen: {
        [index: string]: {
            graphic: AnimationGraphic,
            drawn: boolean
        }
    }
    private offScreen: FactoryQueueMap<AnimationGraphic>;
    private readonly gameData: GameData;
    private readonly graphicClass: IDGraphic<Graphic>;

    constructor({ gameData, graphicClass }: {
        gameData: GameData, graphicClass: IDGraphic<Graphic>
    }) {
        super();
        this.gameData = gameData;
        this.graphicClass = graphicClass;
        this.offScreen = new FactoryQueueMap(this.buildGraphicFunction.bind(this), 10);
        this.onScreen = {};
    }

    private async buildGraphicFunction(id: string) {
        const g = new this.graphicClass({
            gameData: this.gameData,
            id: id
        });
        await g.buildPromise;
        return g;
    }


    draw(state: State, uuid: string, center: Position) {
        if (this.onScreen[uuid] === undefined) {
            const newObj = this.offScreen.dequeueFromIfAvailable(state.id);

            // If it's null, then we simply fail
            // to draw it this frame.
            if (newObj !== null) {
                this.addChild(newObj);
                this.onScreen[uuid] = {
                    graphic: newObj,
                    drawn: false
                }
            }
        }

        const obj = this.onScreen[uuid];
        if (obj) {
            obj.graphic.draw(state, center);
            obj.drawn = true;
        }



    }

    cleanup() {
        // Remove anything that has not been drawn this frame
        for (let [key, obj] of Object.entries(this.onScreen)) {
            if (!obj.drawn) {
                // Remove it
                this.removeChild(obj.graphic);
                delete this.onScreen[key];
                this.offScreen.enqueue(obj.graphic);
            }
            else {
                obj.drawn = false;
            }
        }
    }
}

export { ObjectDrawer };
