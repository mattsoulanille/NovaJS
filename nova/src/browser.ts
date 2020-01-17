import * as PIXI from "pixi.js";
import 'pixi-display'; // Must be imported after PIXI
import * as io from "socket.io-client";
import { Controller } from "./common/Controller";
import { Display } from "./client/display/Display";
import { GameData } from "./client/gamedata/GameData";
import { setupControls } from "./client/setupControls";
import { ShipController } from "./common/ShipController";
import { Engine } from "./engine/Engine";
import { Planet } from "./engine/Planet";
import { Ship } from "./engine/Ship";
import { System } from "./engine/System";
import { SocketChannelClient } from "./communication/SocketChannelClient";
import { Communicator } from "./communication/Communicator";
import { first } from "rxjs/operators";

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
    //    autoResize: true,
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


// Handle when the player's ship changes.
communicator.onShipUUID.subscribe(function([oldUUID, newUUID]: [string | undefined, string]) {
    if (oldUUID) {
        engine.activeShips.delete(oldUUID);
    }
    engine.activeShips.add(newUUID);
    display.target = newUUID;
});


let controller: Controller;
let shipController: ShipController;
async function startGame() {
    if (!communicator.shipUUID) {
        throw new Error("Game started before communicator ready");
    }
    engine.setState(communicator.getStateChanges());

    controller = await setupControls(gameData);
    (window as any).controller = controller;
    shipController = new ShipController(controller);
    app.ticker.add(gameLoop);
}

(window as any).Ship = Ship;

function gameLoop() {
    const delta = app.ticker.elapsedMS;
    if (communicator.shipUUID !== undefined) {
        engine.setShipState(communicator.shipUUID, shipController.generateShipState());
    }
    engine.step(delta);

    if (communicator.shipUUID !== undefined) {
        let currentState = engine.getFullState();
        let currentSystemState = engine.getSystemFullState(
            engine.getShipSystemID(communicator.shipUUID));

        display.draw(currentSystemState);
        communicator.notifyPeers(currentState);

        const stateChanges = communicator.getStateChanges();
        engine.setState(stateChanges);
    }
}

communicator.onReady.pipe(first()).subscribe(startGame);






