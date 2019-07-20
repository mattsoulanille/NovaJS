import { GameState } from "../engine/GameState";
import * as PIXI from "pixi.js";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { StatusBar } from "./StatusBar";
import { GameData } from "./GameData";


class Display {
    readonly container: PIXI.Container;
    gameData: GameData;
    statusBarContainer: PIXI.Container;
    statusBar: StatusBar;
    buildPromise: Promise<void[]>;

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
    }

    draw(state: GameState): GameState {
        return state;
    }

    resize(x: number, y: number) {
        this.statusBar.resize(x, y);
    }

}

export { Display }
