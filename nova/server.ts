import express from "express";
import fs from "fs";
import https from "https";
import path from "path";
import { NovaParse } from "../novaparse/NovaParse";
import { CommunicatorServer } from "./src/communication/CommunicatorServer";
import { SocketChannelServer } from "./src/communication/SocketChannelServer";
import { multiplayer } from "nova_ecs/plugins/multiplayer_plugin";
import { World } from "nova_ecs/world";
import { GameDataResource } from "./src/nova_plugin/game_data_resource";
import { Nova } from "./src/nova_plugin/nova_plugin";
import { ServerPlugin } from "./src/nova_plugin/server_plugin";
import { NovaRepl } from "./src/server/nova_repl";
import { FilesystemData } from "./src/server/parsing/FilesystemData";
import { GameDataAggregator } from "./src/server/parsing/GameDataAggregator";
import { setupRoutes } from "./src/server/setupRoutes";
//import { NovaRepl } from "./src/server/NovaRepl";

type Settings = {
    port: number,
    relativeDataPath: string,
}

const serverSettingsPath = require.resolve("novajs/nova/settings/server.json");
const settings = JSON.parse(fs.readFileSync(serverSettingsPath, "utf8")) as Settings;

// For production, replace these with real https keys
const httpsKeys: https.ServerOptions = {
    key: fs.readFileSync(require.resolve("novajs/nova/test_keys/testkey.pem")),
    cert: fs.readFileSync(require.resolve("novajs/nova/test_keys/testcert.pem")),
};

const app = express();
const httpsServer = https.createServer(httpsKeys, app);


const port: number = settings.port;
const novaDataPath = path.join(__dirname, settings.relativeDataPath);
const novaFileData = new NovaParse(novaDataPath, false);

const filesystemDataPath = path.join(__dirname, "objects");
const filesystemData = new FilesystemData(filesystemDataPath);

const gameData = new GameDataAggregator([filesystemData, novaFileData]);

const htmlPath = require.resolve("novajs/nova/src/index.html");
const bundlePath = require.resolve("novajs/nova/src/browser_bundle.js");
const bundleMapPath = require.resolve("novajs/nova/src/browser_bundle.js.map");
const clientSettingsPath = require.resolve("novajs/nova/settings/controls.json");
setupRoutes(gameData, app, htmlPath, bundlePath, bundleMapPath, clientSettingsPath);

const channel = new SocketChannelServer({ httpsServer });

// async function makeSystems() {
//     const systemIds = (await gameData.ids).System;
//     const systemFactory = engine.stateTreeFactories.get('System');
//     if (!systemFactory) {
//         debugger;
//         throw new Error('Missing system factory');
//     }

//     for (const id of systemIds) {
//         // Using id as uuid since systems are unique.
//         const system = systemFactory(id, id);
//         engine.rootNode.addChild(system);
//     }
// }



const world = new World('test world')
const repl = new NovaRepl();
repl.repl.context.world = world;

let communicator: CommunicatorServer;
async function startGame() {
    httpsServer.listen(port, function() {
        console.log("listening at port " + port);
    });

    // Make the communicator after the systems are built so clients can't connect
    // until everthing is ready.
    communicator = new CommunicatorServer(channel);
    // TODO: Don't just give the server the 'server' uuid
    const multiplayerPlugin = multiplayer(communicator);

    world.resources.set(GameDataResource, gameData);
    world.addPlugin(multiplayerPlugin);
    world.addPlugin(ServerPlugin);
    world.addPlugin(Nova);

    //const novaRepl = new NovaRepl(gameLoop, gameData, communicator);
    stepper();
}

const STEP_TIME = 1000 / 60;
function stepper() {
    // const timeNano = process.hrtime.bigint();
    // const delta = Number((timeNano - lastTimeNano) / BigInt(1e6));
    // lastTimeNano = timeNano;
    world.step();
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

