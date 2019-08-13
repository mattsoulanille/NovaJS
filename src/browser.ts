import * as PIXI from "pixi.js";
import 'pixi-display';
import { Display } from "./client/display/Display";
import { GameState } from "./engine/GameState";
import { GameData } from "./client/GameData";
import { Engine } from "./engine/Engine";
import * as io from "socket.io-client";
import { platform } from "os";

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


engine.setState({
    systems: {
        "sol": {
            uuid: "sol",
            planets: {},
            ships: {
                "ship1": {
                    id: "nova:128",
                    movementType: "inertial",
                    position: { x: 20, y: 20 },
                    rotation: 0,
                    velocity: { x: 0, y: 0 }
                }
            }
        }
    }
});

function updateState(delta: number) {
    engine.step(delta);
    let currentState = engine.getSystemFullState("sol");
    display.draw(currentState);
}

function startGame() {
    app.ticker.add(updateState);
}




startGame();



