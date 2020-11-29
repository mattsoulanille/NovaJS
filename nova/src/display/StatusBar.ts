import * as PIXI from "pixi.js";
import { StatusBarData } from "../../../../novadatainterface/StatusBarData";
import { Position } from "../../engine/Position";
import { GameData } from "../gamedata/GameData";
import { Radar } from "./Radar";
import { SystemState } from "novajs/nova/src/proto/system_state_pb";


class StatusBar extends PIXI.Container {
    readonly gameData: GameData;
    readonly id: string;
    readonly bars: PIXI.Graphics;
    radar: Radar | undefined;
    targetContainer: PIXI.Container;

    data: StatusBarData | undefined;
    font: PIXI.TextStyle | undefined;
    dimFont: PIXI.TextStyle | undefined;
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

        //        this.displayGroup = new PIXI.display.Group(100, true); // appear above others
        this.bars = new PIXI.Graphics();

        this.targetContainer = new PIXI.Container();
        this.addChild(this.bars, this.targetContainer);
        this.buildPromise = this.build()
    }

    private async build() {
        this.data = await this.gameData.data.StatusBar.get(this.id)
        this.baseSprite = await this.gameData.spriteFromPict(this.data.image);


        this.addChild(this.baseSprite)

        //this.font = { fontFamily: "Geneva", fontSize: 12, fill: this.data.colors.brightText, align: 'center' };
        //this.dimFont = { fontFamily: "Geneva", fontSize: 12, fill: this.data.colors.dimText, align: 'center' };



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
