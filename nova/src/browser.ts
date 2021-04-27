import { multiplayer } from "nova_ecs/plugins/multiplayer_plugin";
import { World } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import Stats from 'stats.js';
import { GameData } from "./client/gamedata/GameData";
import { CommunicatorClient } from "./communication/CommunicatorClient";
import { SocketChannelClient } from "./communication/SocketChannelClient";
import { Display } from "./display/display_plugin";
import { PixiAppResource } from "./display/pixi_app_resource";
import { ResizeEvent } from "./display/resize_event";
import { Stage } from "./display/stage_resource";
import { GameDataResource } from "./nova_plugin/game_data_resource";
import { Nova } from "./nova_plugin/nova_plugin";


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

const world = new World('test world');
(window as any).world = world;

function resize() {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    world.emit(ResizeEvent, [window.innerWidth, window.innerHeight] as const);
}
window.onresize = resize;

const channel = new SocketChannelClient({});
const communicator = new CommunicatorClient(channel);
(window as any).communicator = communicator;

async function startGame() {
    const multiplayerPlugin = multiplayer(communicator);

    world.resources.set(GameDataResource, gameData);
    world.resources.set(PixiAppResource, app);

    await world.addPlugin(multiplayerPlugin);
    await world.addPlugin(Nova);
    await world.addPlugin(Display);
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

startGame()




