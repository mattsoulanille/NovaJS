import * as PIXI from "pixi.js";
import 'pixi-display';
import { Display } from "./client/Display";
import { GameState } from "./engine/GameState";
import { GameData } from "./client/GameData";
import { Engine } from "./engine/Engine";
import * as io from "socket.io-client";

const socket = io.Socket;
(window as any).socket = socket;

// Temporary
const gameData = new GameData();
(window as any).gameData = gameData;



const app = new PIXI.Application({
    resolution: window.devicePixelRatio || 1,
    autoResize: true,
    width: window.innerWidth,
    height: window.innerHeight
});

(window as any).app = app;


document.body.appendChild(app.view);


const display = new Display({ container: app.stage, gameData: gameData });
(window as any).display = display;

window.onresize = function() {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    display.resize(window.innerWidth, window.innerHeight);
}

display.buildPromise.then(function() {
    // Set the window size once everything is built
    display.resize(window.innerWidth, window.innerHeight);
});



var engine = new Engine({
    gameData
});
(window as any).engine = engine;

var currentState: GameState;
function updateState(_delta: number) {
    display.draw(currentState, "nobody");
}

function startGame() {
    app.ticker.add(updateState);
}




startGame();



