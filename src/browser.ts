import * as PIXI from "pixi.js";
import 'pixi-display';
import { Display } from "./client/display/Display";
import { GameState } from "./engine/GameState";
import { GameData } from "./client/GameData";
import { Engine } from "./engine/Engine";
import * as io from "socket.io-client";
import { platform } from "os";
import { KeyboardController, Keybindings } from "./client/KeyboardController";
import { Controller } from "./client/Controller";
import { PathReporter } from 'io-ts/lib/PathReporter'
import { setupControls } from "./client/setupControls";
import { ShipController } from "./common/ShipController";
import { Ship } from "./engine/Ship";

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




let controller: Controller;
let shipController: ShipController;
async function startGame() {

    engine.setState({
        systems: {
            "sol": {
                uuid: "sol",
                planets: {},
                ships: {
                    "myship": Ship.fromGameData(await gameData.data.Ship.get("nova:133"))
                }
            }
        }
    });

    engine.activeSystems.add("sol");

    controller = await setupControls(gameData);
    (window as any).controller = controller;
    shipController = new ShipController(controller);
    app.ticker.add(gameLoop);
}

function gameLoop() {
    const delta = app.ticker.elapsedMS;
    engine.setShipState("myship", shipController.generateShipState());

    engine.step(delta);
    let currentState = engine.getSystemFullState("sol");
    display.draw(currentState);
}


startGame();






