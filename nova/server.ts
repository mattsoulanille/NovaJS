import express from "express";
import http from "http";
import socket from "socket.io";
import fs from "fs";
import path from "path";
import { GameDataAggregator } from "./src/server/parsing/GameDataAggregator";
import { setupRoutes } from "./src/server/setupRoutes";
import { FilesystemData } from "./src/server/parsing/FilesystemData";
import { Engine } from "./src/engine/Engine";
import { SocketChannelServer } from "./src/communication/SocketChannelServer";
import { Communicator, StateMessage } from "./src/communication/Communicator";
import { object } from "io-ts";
import { PilotData } from "./src/server/PilotData";
import { Ship } from "./src/engine/Ship";
import { NovaParse } from "../novaparse/NovaParse";

//import { NovaParse } from "../novaparse/NovaParse";

//import * as RootPath from "app-root-path"; // Doesn't work with lerna

//console.log(__dirname);

const settingsPath = require.resolve("novajs/nova/settings/server.json");
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));


const app = express();
const httpServer = new http.Server(app);

const io = socket(httpServer);

const socketChannel = new SocketChannelServer({ io });
const communicator = new Communicator({
    channel: socketChannel
});

console.log("\n\n\n\n")
console.log(__dirname);
console.log("\n\n\n\n")

const port: number = settings.port;
const novaDataPath = path.join(__dirname, settings["relative data path"]);
const novaFileData = new NovaParse(novaDataPath, false);

const filesystemDataPath = path.join(__dirname, "objects");
const filesystemData = new FilesystemData(filesystemDataPath);

filesystemData.data.SpriteSheet.get("planetNeutral").then(console.log);

//console.log(novaFileData);
//novaFileData.data.Ship.get("nova:128").then(console.log);

const gameData = new GameDataAggregator([filesystemData, novaFileData]);
/*
setupRoutes(gameData, app, __dirname);


let engine: Engine;

async function startGame() {
    engine = await Engine.fromGameData(gameData);

    communicator.bindServerConnectionHandler(
        engine.getFullState.bind(engine),
        addClientToGame
    );

    httpServer.listen(port, function() {
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

    const stateChanges = communicator.getStateChanges();
    engine.setState(stateChanges);
    setTimeout(gameLoop, 0);
}

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

startGame();
*/
