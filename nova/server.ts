import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { NovaParse } from "../novaparse/NovaParse";
import { CommunicatorServer } from "./src/communication/CommunicatorServer";
import { SocketChannelServer } from "./src/communication/SocketChannelServer";
import { multiplayer, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { World } from "nova_ecs/world";
import { GameDataResource } from "./src/nova_plugin/game_data_resource";
import { Nova } from "./src/nova_plugin/nova_plugin";
import { ServerPlugin } from "./src/nova_plugin/server_plugin";
import { NovaRepl } from "./src/server/nova_repl";
import { FilesystemData } from "./src/server/parsing/FilesystemData";
import { GameDataAggregator } from "./src/server/parsing/GameDataAggregator";
import { setupRoutes } from "./src/server/setupRoutes";
import * as t from 'io-ts';
import { isLeft } from "fp-ts/lib/Either";
import { makeSystem } from "./src/nova_plugin/make_system";
import { Worker } from "worker_threads";
import * as Comlink from 'comlink';
//import nodeEndpoint from "comlink/dist/esm/node-adapter";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import { NovaParseWorkerApi } from "./src/server/parsing/nova_parse_worker";
import { makeShip } from "./src/nova_plugin/make_ship";
import { v4 } from "uuid";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
//import { NovaRepl } from "./src/server/NovaRepl";


const Settings = t.partial({
    port: t.number,
    relativeDataPath: t.string,
    https: t.boolean,
});
type Settings = t.TypeOf<typeof Settings>;

const runfiles = require(process.env.BAZEL_NODE_RUNFILES_HELPER!) as { resolve: (path: string) => string };

const serverSettingsPath = runfiles.resolve("novajs/nova/settings/server.json");
const maybeSettings = Settings.decode(
    JSON.parse(fs.readFileSync(serverSettingsPath, "utf8")) as unknown);

if (isLeft(maybeSettings)) {
    throw new Error('Failed to parse settings');
}

const settings = maybeSettings.right;
const port = settings.port ?? 8000;
const novaDataPath = path.join(__dirname, settings.relativeDataPath ?? "Nova_Data");

const app = express();
const httpServer = http.createServer(app);

const filesystemDataPath = path.join(__dirname, "objects");
const filesystemData = new FilesystemData(filesystemDataPath);

const htmlPath = runfiles.resolve("novajs/nova/src/index.html");
const bundlePath = runfiles.resolve("novajs/nova/src/browser_bundle.js");
const bundleMapPath = runfiles.resolve("novajs/nova/src/browser_bundle.js.map");
const clientSettingsPath = runfiles.resolve("novajs/nova/settings/controls.json");


const channel = new SocketChannelServer({ server: httpServer });
const novaParseWorkerPath = runfiles.resolve(
    "novajs/nova/src/server/parsing/nova_parse_worker_bundle.js");

let world: World;
const repl = new NovaRepl();

let communicator: CommunicatorServer;
async function startGame() {
    // Set up the novaparse webworker
    const novaParseWorker = new Worker(novaParseWorkerPath);
    const novaParseWorkerApi = Comlink.wrap<NovaParseWorkerApi>(
        nodeEndpoint(novaParseWorker));

    await novaParseWorkerApi.init(novaDataPath);
    const novaFileData = await novaParseWorkerApi.novaParse;
    //const novaFileData = new NovaParse(novaDataPath, false);
    if (!novaFileData) {
        throw new Error("Expected novaparse worker to be defined");
    }
    const gameData = new GameDataAggregator([filesystemData, novaFileData]);
    repl.repl.context.gameData = gameData;
    repl.repl.context.makeShip = makeShip;

    setupRoutes(gameData, app, htmlPath, bundlePath, bundleMapPath, clientSettingsPath);

    httpServer.listen(port, function() {
        console.log("listening at port " + port);
    });

    // Make the communicator after the systems are built so clients can't connect
    // until everthing is ready.
    communicator = new CommunicatorServer(channel);
    // TODO: Don't just give the server the 'server' uuid
    const multiplayerPlugin = multiplayer(communicator);

    world = await makeSystem('nova:130', gameData);
    repl.repl.context.world = world;

    world.resources.set(GameDataResource, gameData);
    await world.addPlugin(multiplayerPlugin);
    await world.addPlugin(ServerPlugin);
    await world.addPlugin(Nova);
    repl.repl.context.addEnemy = async () => {
        const ids = await gameData.ids;
        const randomShipId = ids.Ship[Math.floor(Math.random() * ids.Ship.length)];
        const randomShip = await gameData.data.Ship.get(randomShipId);
        const ship = makeShip(randomShip);
        ship.components.set(MultiplayerData, {
            owner: 'server',
        });
        world.entities.set(v4(), ship);
    }

    stepper();
}

const STEP_TIME = 1000 / 60;
function stepper() {
    world.step();
    setTimeout(stepper, STEP_TIME);
}

startGame();

