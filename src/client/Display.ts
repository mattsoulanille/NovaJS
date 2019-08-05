import { GameState } from "../engine/GameState";
import * as PIXI from "pixi.js";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { StatusBar } from "./StatusBar";
import { GameData } from "./GameData";
import { SpriteSheetSprite } from "./SpriteSheetSprite";
import { ActiveSystemTracker } from "../common/ActiveSystemTracker";
import { ShipData } from "novadatainterface/ShipData";
import { ShipState } from "../engine/ShipState";
import { ShipGraphic } from "./ShipGraphic";


class Display {
    readonly container: PIXI.Container;
    readonly gameData: GameData;
    statusBarContainer: PIXI.Container;
    statusBar: StatusBar;
    readonly buildPromise: Promise<unknown>;
    //    private activeShip: string | undefined; // The uuid of the ship to render from.
    activeSystemTracker: ActiveSystemTracker;
    built: boolean;
    starbridge: ShipGraphic | undefined;


    constructor({ container, gameData }: { container: PIXI.Container, gameData: GameData }) {
        this.container = container;
        this.gameData = gameData;
        this.statusBarContainer = new PIXI.Container();
        this.container.addChild(this.statusBarContainer);
        this.statusBar = new StatusBar({
            container: this.statusBarContainer,
            gameData: this.gameData
        });

        this.built = false;
        this.buildPromise = Promise.all([this.statusBar.buildPromise])
        this.buildPromise.then(() => { this.built = true });
        this.activeSystemTracker = new ActiveSystemTracker();

        this.buildStarbridge();
    }


    draw(state: GameState, activeShipUUID: string) {
        if (this.built && activeShipUUID) {
            const activeSystemUUID = this.activeSystemTracker.getActiveSystem(state, activeShipUUID);
            const activeSystem = state.systems[activeSystemUUID];

            for (let shipUUID in activeSystem.ships) {
                let ship = activeSystem.ships[shipUUID];
                this.drawShip(ship, shipUUID);
            }

        }

    }


    private drawShip(_ship: ShipState, _uuid: string) {


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
