import { SpaceObjectState, SystemState, VectorState } from "novajs/nova/src/proto/protobufjs_bundle";
import * as PIXI from "pixi.js";
import { Display } from "./client/display/Display";
import { GameData } from "./client/gamedata/GameData";
import { setupControls } from "./client/setupControls";
//import 'pixi-display'; // Must be imported after PIXI
//import * as io from "socket.io-client";
import { Controller } from "./common/Controller";
import { ShipController } from "./common/ShipController";
import { CommunicatorClient } from "./communication/CommunicatorClient";
import { SocketChannelClient } from "./communication/SocketChannelClient";
import { EngineView } from "./engine/TreeView";
import { GameLoop } from "./GameLoop";


(window as any).VectorState = VectorState;
(window as any).SpaceObjectState = SpaceObjectState;
(window as any).SystemState = SystemState;

const socketChannel = new SocketChannelClient({});
socketChannel.message.subscribe((m) => {
    console.log("Got a message");
    console.log(m);
});
(window as any).socketChannel = socketChannel;

const communicator = new CommunicatorClient(socketChannel);
(window as any).communicator = communicator;

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


let gameLoop: GameLoop;
let controller: Controller;
let shipController: ShipController;
async function startGame() {
    //    if (!communicator.shipUUID) {
    //        throw new Error("Game started before communicator ready");
    //    }
    //    engine.setState(communicator.getStateChanges());
    const engineView = new EngineView();
    gameLoop = new GameLoop({
        engineView,
        communicator,
        display: (engineView) => {
            // Hardcoded System for now
            const system = engineView.families.systems.
                getChildrenView().children.get("nova:130");
            if (system) {
                display.draw(system);
            }
        }
    });

    (window as any).gameLoop = gameLoop;

    controller = await setupControls(gameData);
    (window as any).controller = controller;
    shipController = new ShipController(controller);
    app.ticker.add(() => {
        gameLoop.step(app.ticker.elapsedMS);
    });

}

//function gameLoop() {
//    const delta = app.ticker.elapsedMS;
// if (communicator.shipUUID !== undefined) {
//     engine.setShipState(communicator.shipUUID, shipController.generateShipState());
// }
//    engine.step(delta);
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
//}

startGame()

//communicator.onReady.pipe(first()).subscribe(startGame);






