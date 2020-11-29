import express from "express";
import fs from "fs";
import https from "https";
import path from "path";
import { NovaParse } from "../novaparse/NovaParse";
//import { CommunicatorServer } from "./src/communication/CommunicatorServer";
//import { SocketChannelServer } from "./src/communication/SocketChannelServer";
import { EngineFactory } from "./src/engine/EngineFactory";
import { SpaceObjectFactory } from "./src/engine/SpaceObjectFactory";
import { GameLoop } from "./src/GameLoop";
import { FilesystemData } from "./src/server/parsing/FilesystemData";
import { GameDataAggregator } from "./src/server/parsing/GameDataAggregator";
import { setupRoutes } from "./src/server/setupRoutes";
//import { NovaRepl } from "./src/server/NovaRepl";

//import { NovaParse } from "../novaparse/NovaParse";

//import * as RootPath from "app-root-path"; // Doesn't work with lerna

//console.log(__dirname);

const serverSettingsPath = require.resolve("novajs/nova/settings/server.json");
const settings = JSON.parse(fs.readFileSync(serverSettingsPath, "utf8"));

// For production, replace these with real https keys
const httpsKeys: https.ServerOptions = {
    key: fs.readFileSync(require.resolve("novajs/nova/test_keys/testkey.pem")),
    cert: fs.readFileSync(require.resolve("novajs/nova/test_keys/testcert.pem")),
};

const app = express();
const httpsServer = https.createServer(httpsKeys, app);

//const socketChannel = new SocketChannelServer({ httpsServer });
// socketChannel.clientConnect.subscribe((client) => {
//     console.log(`New client: ${client}`);
// });

// socketChannel.clientDisconnect.subscribe((client) => {
//     console.log(`Client disconnected: ${client}`);
// });

// socketChannel.message.subscribe((message) => {
//     console.log(message);
// });


//const communicator = new CommunicatorServer(socketChannel);

const port: number = settings.port;
const novaDataPath = path.join(__dirname, settings["relative data path"]);
const novaFileData = new NovaParse(novaDataPath, false);

const filesystemDataPath = path.join(__dirname, "objects");
const filesystemData = new FilesystemData(filesystemDataPath);

//filesystemData.data.SpriteSheet.get("planetNeutral").then(console.log);

//console.log(novaFileData);
//novaFileData.data.Ship.get("nova:128").then(console.log);

const gameData = new GameDataAggregator([filesystemData, novaFileData]);

const htmlPath = require.resolve("novajs/nova/src/index.html");
const bundlePath = require.resolve("novajs/nova/src/browser_bundle.js");
const clientSettingsPath = require.resolve("novajs/nova/settings/controls.json");
setupRoutes(gameData, app, htmlPath, bundlePath, clientSettingsPath);

const engineFactory = new EngineFactory(gameData);
const spaceObjectFactory = new SpaceObjectFactory(gameData);

let gameLoop: GameLoop;
let lastTimeNano: bigint;
async function startGame() {
    const engine = await engineFactory.newWithSystems();
    engine.systems.get("nova:130")?.spaceObjects.set("test object",
        await spaceObjectFactory.shipFromId("nova:128"));

    gameLoop = new GameLoop({ engine, });//communicator })

    httpsServer.listen(port, function() {
        console.log("listening at port " + port);
    });

    //const novaRepl = new NovaRepl(gameLoop, gameData, communicator);
    lastTimeNano = process.hrtime.bigint();
    stepper();
}

const STEP_TIME = 1000 / 60;
function stepper() {
    const timeNano = process.hrtime.bigint();
    const delta = Number((timeNano - lastTimeNano) / BigInt(1e6));
    lastTimeNano = timeNano;

    gameLoop.step(delta);
    setTimeout(stepper, STEP_TIME);
}

//    const stateChanges = communicator.getStateChanges();
//    engine.setState(stateChanges);
//    setTimeout(gameLoop, 0);

/*
async function addClientToGame() {
    const shipID = (await new PilotData().getShip()).id;
    const shipState = await Ship.fromID(shipID, gameData);
    const shipUUID = engine.newShipInSystem(shipState, "nova:130");
    engine.activeShips.add(shipUUID);


    return {
        clientUUIDs: new Set([shipUUID]),
        shipUUID: shipUUID
    }
}
*/

startGame();

