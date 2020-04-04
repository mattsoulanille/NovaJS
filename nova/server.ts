import express from "express";
import https from "https";
import socket from "socket.io";
import fs from "fs";
import path from "path";
import { GameDataAggregator } from "./src/server/parsing/GameDataAggregator";
import { setupRoutes } from "./src/server/setupRoutes";
import { FilesystemData } from "./src/server/parsing/FilesystemData";
import { Engine } from "./src/engine/Engine";
import { SocketChannelServer } from "./src/communication/SocketChannelServer";
//import { Communicator, StateMessage } from "./src/communication/Communicator";
import { object } from "io-ts";
import { PilotData } from "./src/server/PilotData";
import { Ship } from "./src/engine/Ship";
import { NovaParse } from "../novaparse/NovaParse";
import { VectorState } from "novajs/nova/src/proto/vector_state_pb";


const testv = new VectorState();
testv.setX(4);
testv.setY(5);
console.log(testv.serializeBinary());

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

const socketChannel = new SocketChannelServer({ httpsServer });
socketChannel.onPeerConnect.subscribe((peer) => {
    console.log(`New peer: ${peer}`);
});

socketChannel.onPeerDisconnect.subscribe((peer) => {
    console.log(`Peer disconnected: ${peer}`);
});

socketChannel.onMessage.subscribe((message) => {
    console.log(message);
});



//const communicator = new Communicator({
//    channel: socketChannel
//});

const port: number = settings.port;
const novaDataPath = path.join(__dirname, settings["relative data path"]);
const novaFileData = new NovaParse(novaDataPath, false);

const filesystemDataPath = path.join(__dirname, "objects");
const filesystemData = new FilesystemData(filesystemDataPath);

filesystemData.data.SpriteSheet.get("planetNeutral").then(console.log);

//console.log(novaFileData);
//novaFileData.data.Ship.get("nova:128").then(console.log);

const gameData = new GameDataAggregator([filesystemData, novaFileData]);

const htmlPath = require.resolve("novajs/nova/src/index.html");
const bundlePath = require.resolve("novajs/nova/src/browser_bundle.js");
const clientSettingsPath = require.resolve("novajs/nova/settings/controls.json");
setupRoutes(gameData, app, htmlPath, bundlePath, clientSettingsPath);

let engine: Engine;

async function startGame() {
    engine = await Engine.fromGameData(gameData);
    /*
        communicator.bindServerConnectionHandler(
            engine.getFullState.bind(engine),
            addClientToGame
        );
    */
    httpsServer.listen(port, function() {
        console.log("listening at port " + port);
    });

    lastTimeNano = process.hrtime.bigint();
    gameLoop();
}

let lastTimeNano: bigint;
function gameLoop() {
    const timeNano = process.hrtime.bigint();
    const delta = Number((timeNano - lastTimeNano) / BigInt(1e6));
    lastTimeNano = timeNano;
    engine.step(delta);

    //    const stateChanges = communicator.getStateChanges();
    //    engine.setState(stateChanges);
    //    setTimeout(gameLoop, 0);
}
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

