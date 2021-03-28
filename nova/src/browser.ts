import * as PIXI from "pixi.js";
import { GameData } from "./client/gamedata/GameData";
import { CommunicatorClient } from "./communication/CommunicatorClient";
import { SocketChannelClient } from "./communication/SocketChannelClient";
import { multiplayer } from "nova_ecs/plugins/multiplayer_plugin";
import { World } from "nova_ecs/world";
import { GameDataResource } from "./nova_plugin/game_data_resource";
import { Nova } from "./nova_plugin/nova_plugin";
import { Display, Stage } from "./display/display_plugin";
import Stats from 'stats.js';
import { ShipController } from "./client/ship_controller_plugin";

// const socketChannel = new SocketChannelClient({});
// socketChannel.message.subscribe((m) => {
//     console.log("Got a message");
//     console.log(m);
// });
// (window as any).socketChannel = socketChannel;

// const communicator = new CommunicatorClient(socketChannel);
// (window as any).communicator = communicator;

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

//const display = new Display({ gameData: gameData });
//app.stage.addChild(display.displayObject);
//(window as any).display = display;

function resize() {
    app.renderer.resize(window.innerWidth, window.innerHeight);
}
window.onresize = resize;
window.onload = resize;

// display.buildPromise.then(function() {
//     // Set the window size once everything is built
//     display.resize(window.innerWidth, window.innerHeight);
// });


//const engine = new Engine(gameData);
const channel = new SocketChannelClient({});
const communicator = new CommunicatorClient(channel);
const world = new World('test world');
(window as any).world = world;
//const gameLoop = new GameLoop(engine, communicator);
//(window as any).engine = engine;
(window as any).communicator = communicator;
//(window as any).gameLoop = gameLoop;

async function startGame() {
    //controller = await setupControls(gameData);
    //(window as any).controller = controller;
    //shipController = new ShipController(controller);
    const multiplayerPlugin = multiplayer(communicator);

    world.resources.set(GameDataResource, gameData);
    world.addPlugin(multiplayerPlugin);
    world.addPlugin(Nova);
    world.addPlugin(Display);
    world.addPlugin(ShipController);
    const worldContainer = world.resources.get(Stage);
    if (!worldContainer) {
        throw new Error('World did not have Pixi Container');
    }
    app.stage.addChild(worldContainer);

    const stats = new Stats();
    document.body.appendChild(stats.dom);

    app.ticker.add(() => {
        stats.begin();
        world.step();
        stats.end();
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






