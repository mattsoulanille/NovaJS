import express from "express";
import http from "http";
import socket from "socket.io";
import { NovaParse } from "novaparse/NovaParse";
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
//import * as RootPath from "app-root-path"; // Doesn't work with lerna

const appRoot: string = path.join(__dirname, "../");

const settings = JSON.parse(fs.readFileSync("./settings/server.json", "utf8"));

const app = express();
const httpServer = new http.Server(app);
const io = socket(httpServer);
const socketChannel = new SocketChannelServer({ io });
const communicator = new Communicator({
    channel: socketChannel
});

const port: number = settings.port;
const novaDataPath: string = path.join(appRoot, settings["relative data path"]);
//const novaDataPath: string = path.join(__dirname, "Nova\ Data");



const novaFileData = new NovaParse(novaDataPath, false);
const filesystemData = new FilesystemData(path.join(appRoot, "/objects/"));
const gameData = new GameDataAggregator([filesystemData, novaFileData]);
setupRoutes(gameData, app, appRoot);


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
