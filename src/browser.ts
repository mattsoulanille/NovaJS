import * as PIXI from "pixi.js";
import 'pixi-display'; // Must be imported after PIXI
import * as io from "socket.io-client";
import { Controller } from "./client/Controller";
import { Display } from "./client/display/Display";
import { GameData } from "./client/GameData";
import { setupControls } from "./client/setupControls";
import { ShipController } from "./common/ShipController";
import { Engine } from "./engine/Engine";
import { Planet } from "./engine/Planet";
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
                planets: {
                    "earth": await Planet.fromID("nova:128", gameData)
                },
                ships: {
                    "myship": await Ship.fromID("nova:133", gameData),
                    "anotherShip": await Ship.fromID("nova:128", gameData)
                }
            }
        }
    });
    engine.activeSystems.add("sol");
    display.target = "myship";
    controller = await setupControls(gameData);
    (window as any).controller = controller;
    shipController = new ShipController(controller);
    app.ticker.add(gameLoop);
}

(window as any).Ship = Ship;

function gameLoop() {
    const delta = app.ticker.elapsedMS;
    engine.setShipState("myship", shipController.generateShipState());

    engine.step(delta);
    let currentState = engine.getSystemFullState("sol");
    display.draw(currentState);
}


startGame();






