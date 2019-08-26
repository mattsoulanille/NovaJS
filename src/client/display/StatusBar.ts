import { StatusBarData } from "novadatainterface/StatusBarData";
import * as PIXI from "pixi.js";
import { GameData } from "../GameData";
import { SystemState } from "../../engine/SystemState";
import { Radar } from "./Radar";
import { VectorLike } from "../../engine/Vector";
import { Position } from "../../engine/Position";

class StatusBar extends PIXI.Container {
    readonly gameData: GameData;
    readonly id: string;
    readonly bars: PIXI.Graphics;
    radar: Radar | undefined;
    targetContainer: PIXI.Container;

    data: StatusBarData | undefined;
    font: PIXI.TextStyleOptions | undefined;
    dimFont: PIXI.TextStyleOptions | undefined;
    baseSprite: PIXI.Sprite | undefined;
    buildPromise: Promise<void>;


    constructor({ gameData, id }: { gameData: GameData, id?: string }) {
        super();
        this.gameData = gameData;

        if (id === undefined) {
            this.id = "nova:128"
        }
        else {
            this.id = id
        }

        this.displayGroup = new PIXI.DisplayGroup(100, true); // appear above others
        this.bars = new PIXI.Graphics();

        this.targetContainer = new PIXI.Container();
        this.addChild(this.bars, this.targetContainer);
        this.buildPromise = this.build()
    }

    private async build() {
        this.data = await this.gameData.data.StatusBar.get(this.id)
        this.baseSprite = await this.gameData.spriteFromPict(this.data.image);


        this.addChild(this.baseSprite)

        this.font = { fontFamily: "Geneva", fontSize: 12, fill: this.data.colors.brightText, align: 'center' };
        this.dimFont = { fontFamily: "Geneva", fontSize: 12, fill: this.data.colors.dimText, align: 'center' };



        this.radar = new Radar({
            dimensions: {
                x: this.data.dataAreas.radar.size[0],
                y: this.data.dataAreas.radar.size[1]
            }
        });

        this.addChild(this.radar)
        this.radar.position.x = this.data.dataAreas.radar.position[0];
        this.radar.position.y = this.data.dataAreas.radar.position[1];

    }

    draw(state: SystemState, targetPosition: Position) {
        if (this.radar) {
            this.radar.draw(state, targetPosition);
        }
    }

    resize(x: number, _y: number) {
        this.position.x = x - this.width;
    }
}

export { StatusBar };
