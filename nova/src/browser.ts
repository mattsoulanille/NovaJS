import * as PIXI from "pixi.js";
//import 'pixi-display'; // Must be imported after PIXI
//import * as io from "socket.io-client";
import io from "socket.io-client";
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
//import { Communicator } from "./communication/Communicator";
import { first } from "rxjs/operators";
import { VectorState } from "novajs/nova/src/proto/vector_state_pb";
import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";

import { SystemState } from "novajs/nova/src/proto/system_state_pb";

(window as any).VectorState = VectorState;
(window as any).SpaceObjectState = SpaceObjectState;
(window as any).SystemState = SystemState;

const socketChannel = new SocketChannelClient({});
socketChannel.onMessage.subscribe(console.log);
socketChannel.onPeerConnect.subscribe((uuid) => {
    console.log(`new peer ${uuid}`);
});
socketChannel.onPeerDisconnect.subscribe((uuid) => {
    console.log(`peer disconnected ${uuid}`);
});
(window as any).socketChannel = socketChannel;

//const communicator = new Communicator({
//    channel: socketChannel
//});
//(window as any).communicator = communicator;

// Temporary
const gameData = new GameData();
(window as any).gameData = gameData;
(window as any).PIXI = PIXI;

const pixelRatio = window.devicePixelRatio || 1;
PIXI.settings.RESOLUTION = pixelRatio;
const app = new PIXI.Application({
    width: window.innerWidth * pixelRatio,
    height: window.innerHeight * pixelRatio,
    autoDensity: true
});


(window as any).app = app;
document.body.appendChild(app.view);


const display = new Display({ gameData: gameData });
app.stage.addChild(display.displayObject);
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

/*
// Handle when the player's ship changes.
communicator.onShipUUID.subscribe(function([oldUUID, newUUID]: [string | undefined, string]) {
    if (oldUUID) {
        engine.activeShips.delete(oldUUID);
    }
    engine.activeShips.add(newUUID);
    display.target = newUUID;
});
*/

let controller: Controller;
let shipController: ShipController;
async function startGame() {
    //    if (!communicator.shipUUID) {
    //        throw new Error("Game started before communicator ready");
    //    }
    //    engine.setState(communicator.getStateChanges());

    controller = await setupControls(gameData);
    (window as any).controller = controller;
    shipController = new ShipController(controller);
    app.ticker.add(gameLoop);
}

(window as any).Ship = Ship;

function gameLoop() {
    const delta = app.ticker.elapsedMS;
    // if (communicator.shipUUID !== undefined) {
    //     engine.setShipState(communicator.shipUUID, shipController.generateShipState());
    // }
    engine.step(delta);
    /*
        if (communicator.shipUUID !== undefined) {
            let currentState = engine.getFullState();
            let currentSystemState = engine.getSystemFullState(
                engine.getShipSystemID(communicator.shipUUID));
    
            display.draw(currentSystemState);
            communicator.notifyPeers(currentState);
    
            const stateChanges = communicator.getStateChanges();
            engine.setState(stateChanges);
        }
    */
}

//communicator.onReady.pipe(first()).subscribe(startGame);






