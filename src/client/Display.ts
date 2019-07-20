import { GameState } from "../engine/GameState";
import * as PIXI from "pixi.js";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { StatusBar } from "./StatusBar";
import { GameData } from "./GameData";
import { SpriteSheetSprite } from "./SpriteSheetSprite";


class Display {
    readonly container: PIXI.Container;
    gameData: GameData;
    statusBarContainer: PIXI.Container;
    statusBar: StatusBar;
    readonly buildPromise: Promise<unknown>;
    starbridge: SpriteSheetSprite | undefined;

    constructor({ container, gameData }: { container: PIXI.Container, gameData: GameData }) {
        this.container = container;
        this.gameData = gameData;
        this.statusBarContainer = new PIXI.Container();
        this.container.addChild(this.statusBarContainer);
        this.statusBar = new StatusBar({
            container: this.statusBarContainer,
            gameData: this.gameData
        });


        this.buildPromise = Promise.all([this.statusBar.buildPromise]);
        this.buildStarbridge();
    }

    draw(state: GameState): GameState {
        return state;
    }

    resize(x: number, y: number) {
        this.statusBar.resize(x, y);
    }

    async buildStarbridge() {
        let ship = await this.gameData.data.Ship.get("nova:133");
        this.starbridge = new SpriteSheetSprite({
            id: "nova:1010",
            gameData: this.gameData,
            imagePurposes: ship.animation.images.baseImage.imagePurposes
        });

        this.container.addChild(this.starbridge)
        this.starbridge.position.x = 300;
        this.starbridge.position.y = 300;
    }

}

export { Display }
