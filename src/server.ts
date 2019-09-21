import * as express from "express";
import * as http from "http";
import * as socket from "socket.io";
import { NovaParse } from "novaparse";
import * as fs from "fs";
import * as path from "path";
import { GameDataAggregator } from "./server/parsing/GameDataAggregator";
import { setupRoutes } from "./server/setupRoutes";
import { FilesystemData } from "./server/parsing/FilesystemData";
import { Engine } from "./engine/Engine";
import { SocketChannelServer } from "./communication/SocketChannelServer";
import { Communicator, StateMessage } from "./communication/Communicator";
import { object } from "io-ts";
import { PilotData } from "./server/PilotData";
import { Ship } from "./engine/Ship";
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
}

async function addClientToGame() {
    const shipID = (await new PilotData().getShip()).id;
    const shipState = await Ship.fromID(shipID, gameData);
    const shipUUID = engine.newShipInSystem(shipState, "nova:130");
    return {
        clientUUIDs: new Set([shipUUID]),
        shipUUID: shipUUID
    }
}

startGame();
