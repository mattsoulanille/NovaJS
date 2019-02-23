import * as PIXI from "pixi.js";
import 'pixi-display';
import { Display } from "./client/Display";
import { GameState } from "./engine/GameState";
import { GameData } from "./client/GameData";
//import * as io from "socket.io-client";


// Temporary
(window as any).gameData = new GameData();



const app = new PIXI.Application({
    resolution: window.devicePixelRatio || 1,
    autoResize: true,
    width: window.innerWidth,
    height: window.innerHeight
});

document.body.appendChild(app.view);

const display = new Display(app.stage);


//var engine = new Engine();

var currentState: GameState;
function updateState(delta: number) {
    currentState = display.draw(currentState, delta);
}

function startGame() {
    //io.Socket.emit("pingTest", "Hello from the client");
    app.ticker.add(updateState);
}


startGame();



