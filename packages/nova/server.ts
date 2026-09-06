import * as Comlink from 'comlink';
import nodeEndpointImport from 'comlink/dist/umd/node-adapter.js';
const nodeEndpoint = nodeEndpointImport as unknown as typeof nodeEndpointImport.default;
import express from "express";
import { isLeft } from "fp-ts/lib/Either.js";
import fs from "fs";
import http from "http";
import * as t from 'io-ts';
import { MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { World } from "nova_ecs/world";
import path from "path";
import { fileURLToPath } from 'url';
import { v4 } from "uuid";
import { Worker } from "worker_threads";
import { CommunicatorServer } from "./src/communication/communicator_server.js";
import { MultiRoom } from './src/communication/multi_room_communicator.js';
import { SocketChannelServer } from "./src/communication/socket_channel_server.js";
import { SimulationGameDataResource } from './src/nova_plugin/game_data_resource.js';
import { makeShip } from "./src/nova_plugin/make_ship.js";
import { SIMULATION_STEP_MS } from "./src/nova_plugin/make_system.js";
import { MultiRoomResource, NovaPlugin } from './src/nova_plugin/nova_plugin.js';
import { ServerPlugin } from "./src/nova_plugin/server_plugin.js";
import { NovaRepl } from "./src/server/nova_repl.js";
import { FilesystemData } from "./src/server/parsing/filesystem_data.js";
import { GameDataAggregator } from "./src/server/parsing/game_data_aggregator.js";
import { NovaParseWorkerApi } from "./src/server/parsing/nova_parse_worker.js";
import { setupRoutes } from "./src/server/setup_routes.js";
import { registerVersionRoute } from "./src/server/version_route.js";
import { BUILD_VERSION } from "./src/common/generated_build_version.js";

const Settings = t.partial({
    port: t.number,
    relativeDataPath: t.string,
});
type Settings = t.TypeOf<typeof Settings>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverSettingsPath = path.join(__dirname, "../settings/server.json");
const maybeSettings = Settings.decode(
    JSON.parse(fs.readFileSync(serverSettingsPath, "utf8")) as unknown);

if (isLeft(maybeSettings)) {
    throw new Error('Failed to parse settings');
}

const settings = maybeSettings.right;
const port = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : settings.port ?? 8000;
const novaDataPath = process.env.NOVA_DATA_PATH
    ? process.env.NOVA_DATA_PATH
    : path.join(__dirname, settings.relativeDataPath ?? "../Nova_Data");
console.log(novaDataPath);

const app = express();
const httpServer = http.createServer(app);

console.log("build version: " + BUILD_VERSION);

// The client's build-version preflight. Registered here, before
// setupRoutes' catch-all `/` handler, for the same reason the title-music
// route below is. This route only REPORTS the build; the enforcement is
// the websocket admission check in SocketChannelServer, which is given the
// same stamp.
registerVersionRoute(app, BUILD_VERSION);

// The title screen streams the original's theme, `Nova Music.mp3`, straight
// from the game data. It's a plain ~9 MB mp3 (not a `snd` resource), so it
// deliberately skips the parsed-resource pipeline: one whitelisted static
// route, NOT the whole data directory. Registered here (before setupRoutes'
// catch-all `/` handler) so it wins, and served with `sendFile` so the
// browser gets Range support (streaming + looping) and a cache header.
const novaMusicPath = path.join(novaDataPath, "Nova Files", "Nova Music.mp3");
app.get("/title_music.mp3", (_req, res) => {
    res.sendFile(novaMusicPath, { maxAge: "1d" }, (err) => {
        if (err && !res.headersSent) {
            res.status(404).end();
        }
    });
});

const filesystemDataPath = path.join(__dirname, "../objects");
const filesystemData = new FilesystemData(filesystemDataPath);

const htmlPath = path.join(__dirname, "../src/index.html");
const bundlePath = path.join(__dirname, "src/browser_bundle.js");
const bundleMapPath = path.join(__dirname, "src/browser_bundle.js.map");
const simulationWorkerBundlePath = path.join(__dirname, "src/communication/simulation_bridge_browser_worker_bundle.js");
const simulationWorkerBundleMapPath = path.join(__dirname, "src/communication/simulation_bridge_browser_worker_bundle.js.map");
const clientSettingsDir = path.join(__dirname, "../settings");


// Passing the build stamp arms the version gate: a client that announces a
// different build (or none) is closed before it is admitted, so it can
// never reach a room and desync against updated peers.
const channel = new SocketChannelServer({
    server: httpServer,
    buildVersion: BUILD_VERSION,
});
const novaParseWorkerPath = path.join(__dirname, "src/server/parsing/nova_parse_worker_bundle.cjs");

let world: World;
let systemWorld: World;
const repl = new NovaRepl();

let communicator: CommunicatorServer;
async function startGame() {
    // Set up the novaparse webworker. No `stdout`/`stderr: true`: the
    // worker's console output (plug-in load diagnostics, see
    // nova_parse_worker.ts) is piped into this process's, i.e. the server
    // log.
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

    setupRoutes(
        gameData,
        app,
        htmlPath,
        bundlePath,
        bundleMapPath,
        simulationWorkerBundlePath,
        simulationWorkerBundleMapPath,
        clientSettingsDir,
    );

    httpServer.listen(port, function () {
        console.log("listening at port " + port);
    });

    communicator = new CommunicatorServer(channel);
    const multiRoom = new MultiRoom(communicator);
    // TODO: Don't just give the server the 'server' uuid

    world = new World();
    world.resources.set(SimulationGameDataResource, gameData);
    // NO legacy delta-sync multiplayer plugin on this world. Rollback
    // rooms (ServerPlugin's per-system RollbackRelay + RoomArchive)
    // replaced it entirely; the 'main room' it joined had no remaining
    // gameplay purpose, and its message handler applied `remove` and
    // `state` from ANY peer with its ownership checks commented out
    // (nova_ecs/plugins/multiplayer_plugin.ts) — an unauthenticated
    // way to inject entities into this continuously-stepped world and
    // delete everyone else's. Nothing reads this world's entities any
    // more; ServerPlugin only needs the resources set here.
    world.resources.set(MultiRoomResource, multiRoom);
    await world.addPlugin(NovaPlugin);

    repl.repl.context.world = world;

    await world.addPlugin(ServerPlugin);
    repl.repl.context.addEnemy = async (id?: string) => {
        const ids = await gameData.ids;
        id = id ?? ids.Ship[Math.floor(Math.random() * ids.Ship.length)];
        const randomShip = await gameData.data.Ship.get(id);
        const ship = makeShip(randomShip);
        ship.components.set(MultiplayerData, {
            owner: 'server',
        });
        //systemWorld.entities.set(v4(), ship);
        world.entities.set(v4(), ship);
    }

    stepper();
}

// The simulation worlds run on a fixed timestep, so convert real
// elapsed time into a whole number of world steps and carry the
// remainder. Catch-up is bounded both in total debt and per timer
// callback so stepping never starves the server's event loop (it also
// serves HTTP requests for game assets).
const MAX_CATCHUP_STEPS = 4;
const MAX_STEPS_PER_CALLBACK = 2;
let stepTimeDebt = 0;
let lastStepTime: number | undefined;
function stepper() {
    const now = performance.now();
    if (lastStepTime !== undefined) {
        stepTimeDebt += now - lastStepTime;
    }
    lastStepTime = now;
    stepTimeDebt = Math.min(stepTimeDebt, SIMULATION_STEP_MS * MAX_CATCHUP_STEPS);
    let steps = Math.min(Math.floor(stepTimeDebt / SIMULATION_STEP_MS),
        MAX_STEPS_PER_CALLBACK);
    stepTimeDebt -= steps * SIMULATION_STEP_MS;
    while (steps > 0) {
        world.step();
        steps--;
    }
    setTimeout(stepper, SIMULATION_STEP_MS);
}

startGame().catch((err) => {
    console.error("Failed to start game server:", err);
    process.exit(1);
});
