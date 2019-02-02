import { GameState } from "../engine/GameState";
import * as PIXI from "pixi.js";


class Display {
    text: PIXI.Text;
    readonly container: PIXI.Container;

    constructor(container: PIXI.Container) {
        this.container = container;

        const style = new PIXI.TextStyle({
            fill: "#ff3328"
        });

        this.text = new PIXI.Text("This is a test", style);
        this.text.position.x = 100;
        this.text.position.y = 100;
        this.text.anchor.x = 0.5;
        this.text.anchor.y = 0.5;
        this.container.addChild(this.text);
    }

    draw(state: GameState, delta: number): GameState {
        this.text.rotation += delta / 500;
        return state;
    }

}

export { Display }
