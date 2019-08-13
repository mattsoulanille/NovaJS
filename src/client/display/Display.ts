import { GameState } from "../../engine/GameState";
import * as PIXI from "pixi.js";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { StatusBar } from "./StatusBar";
import { GameData } from "../GameData";
import { SpriteSheetSprite } from "./SpriteSheetSprite";
import { ShipData } from "novadatainterface/ShipData";
import { ShipState } from "../../engine/ShipState";
import { ShipGraphic } from "./ShipGraphic";
import { SystemState } from "../../engine/SystemState";


class Display {
    readonly container: PIXI.Container;
    readonly gameData: GameData;
    statusBarContainer: PIXI.Container;
    statusBar: StatusBar;
    readonly buildPromise: Promise<unknown>;
    //    private activeShip: string | undefined; // The uuid of the ship to render from.
    built: boolean;
    starbridge: ShipGraphic | undefined;

    shipGraphics: { [index: string]: ShipGraphic }


    constructor({ container, gameData }: { container: PIXI.Container, gameData: GameData }) {
        this.container = container;
        this.gameData = gameData;
        this.statusBarContainer = new PIXI.Container();
        this.container.addChild(this.statusBarContainer);
        this.statusBar = new StatusBar({
            container: this.statusBarContainer,
            gameData: this.gameData
        });

        this.shipGraphics = {};

        this.built = false;
        this.buildPromise = Promise.all([this.statusBar.buildPromise])
        this.buildPromise.then(() => { this.built = true });

        this.buildStarbridge();
    }


    draw(state: SystemState) {
        for (let shipID in state.ships) {
            let ship = state.ships[shipID];
            this.drawShip(ship, shipID);
        }
    }


    private drawShip(ship: ShipState, uuid: string) {
        if (!(uuid in this.shipGraphics)) {
            let newGraphic = new ShipGraphic({
                gameData: this.gameData,
                id: ship.id
            });
            this.shipGraphics[uuid] = newGraphic;
            this.container.addChild(newGraphic);
        }

        let s = this.shipGraphics[uuid];
        s.position.x = ship.position.x;
        s.position.y = ship.position.y;
        s.rotation = ship.rotation;
    }

    resize(x: number, y: number) {
        this.statusBar.resize(x, y);
    }

    async buildStarbridge() {
        this.starbridge = new ShipGraphic({ gameData: this.gameData, id: "nova:133" });
        this.starbridge.visible = true;
        this.container.addChild(this.starbridge)
        this.starbridge.position.x = 300;
        this.starbridge.position.y = 300;
    }

}

export { Display }
