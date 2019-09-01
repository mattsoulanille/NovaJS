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
import { System } from "./engine/System";
import { SocketChannelClient } from "./communication/SocketChannelClient";
import { Communicator } from "./communication/Communicator";

const socket = io();
(window as any).socket = socket;
const socketChannel = new SocketChannelClient({ socket });
const communicator = new Communicator({
    channel: socketChannel
});
(window as any).communicator = communicator;

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

    let solState = await System.fromID("nova:130", gameData);

    solState.ships.myship = await Ship.fromID("nova:133", gameData);
    solState.ships.anotherShip = await Ship.fromID("nova:128", gameData);

    solState.ships.leftof = await Ship.fromID("nova:129", gameData);
    solState.ships.leftof.position.x = 9950;
    solState.ships.rightof = await Ship.fromID("nova:130", gameData);
    solState.ships.rightof.position.x = 10050;

    solState.ships.leftOfEarth = await Ship.fromID("nova:128", gameData);
    solState.ships.rightOfEarth = await Ship.fromID("nova:128", gameData);

    solState.ships.leftOfEarth.position.x = -50;
    solState.ships.rightOfEarth.position.x = 50;

    engine.setState({
        systems: {
            "sol": solState
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
    let currentState = engine.getSystemContainingShip("myship");
    display.draw(currentState);
}


startGame();






