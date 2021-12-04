import { AddEvent } from "nova_ecs/events";
import { multiplayer } from "nova_ecs/plugins/multiplayer_plugin";
import { World } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import Stats from 'stats.js';
import { GameData } from "./client/gamedata/GameData";
import { CommunicatorClient } from "./communication/CommunicatorClient";
import { MultiRoom } from "./communication/MultiRoomCommunicator";
import { SocketChannelClient } from "./communication/SocketChannelClient";
import { DebugSettings } from "./debug_settings";
import { Display } from "./display/display_plugin";
import { PixiAppResource } from "./display/pixi_app_resource";
import { ResizeEvent } from "./display/screen_size_plugin";
import { Stage } from "./display/stage_resource";
import { GameDataResource } from "./nova_plugin/game_data_resource";
import { ActiveSystemComponent, MultiRoomResource, NovaPlugin, SystemComponent } from "./nova_plugin/nova_plugin";
import { PlayerShipSelector } from "./nova_plugin/player_ship_plugin";
import { SystemsResource } from "./nova_plugin/systems_resource";


const gameData = new GameData();
(window as any).gameData = gameData;
(window as any).PIXI = PIXI;

const pixelRatio = window.devicePixelRatio || 1;
PIXI.settings.RESOLUTION = pixelRatio;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

// TODO: Using WebGL 1 (instead of 2) seems to make the game smoother, but
// this will likely change in the future.
//PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL2;
const app = new PIXI.Application({
    width: window.innerWidth * pixelRatio,
    height: window.innerHeight * pixelRatio,
    autoDensity: true
});

(window as any).app = app;
document.body.appendChild(app.view);

const channel = new SocketChannelClient({});
const communicator = new CommunicatorClient(channel);
(window as any).communicator = communicator;
const multiRoom = new MultiRoom(communicator);

function findPlayerShip(systems: Iterable<[string, World]>) {
    for (const [id, system] of systems) {
        for (const entity of system.entities.values()) {
            if (entity.components.has(PlayerShipSelector)) {
                return [id, system];
            }
        }
    }
    return;
}

let world: World;
let activeSystem: World | undefined;
async function startGame() {
    world = new World();
    world.resources.set(GameDataResource, gameData);
    await world.addPlugin(multiplayer(multiRoom.join('main room')));
    world.resources.set(MultiRoomResource, multiRoom);
    await world.addPlugin(NovaPlugin);

    const systems = world.resources.get(SystemsResource);
    if (!systems) {
        throw new Error('World must have systems resource');
    }

    for (const system of systems.values()) {
        system.resources.set(PixiAppResource, app);
    }

    //activeSystem = findPlayerShip(systems);
    activeSystem = systems.get('nova:131');
    world.entities.get('nova:131')!.components.set(ActiveSystemComponent, true);
    console.log(`Active system ${activeSystem}`);
    if (activeSystem) {
        await activeSystem.addPlugin(Display);

        const systemStage = activeSystem.resources.get(Stage);
        if (!systemStage) {
            throw new Error('World did not have Pixi Container');
        }
        app.stage.addChild(systemStage);
        systemStage.visible = true;
    }

    // Set active system when the player ship is added    
    for (const [systemId, system] of systems) {
        system.events.get(AddEvent).subscribe(([, entity]) => {
            //console.log('hi');
            if (entity.components.has(PlayerShipSelector) &&
                system !== activeSystem) {
                console.log(`Player ship is in ${systemId}`);
                const systemStage = activeSystem?.resources.get(Stage);
                if (systemStage) {
                    app.stage.removeChild(systemStage);
                }

                activeSystem?.removePlugin(Display);
                activeSystem = system;
                activeSystem.addPlugin(Display);

                const newSystemStage = activeSystem?.resources.get(Stage);

                if (!newSystemStage) {
                    throw new Error('World did not have Pixi Container');
                }
                app.stage.addChild(newSystemStage);
            }
        });
    }
    console.log('Got past for loop');

    (window as any).world = world;

    function resize() {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        activeSystem?.emit(ResizeEvent, { x: window.innerWidth, y: window.innerHeight });
    }
    window.onresize = resize;

    const stats = new Stats();
    document.body.appendChild(stats.dom);

    //(window as any).novaDebug = new DebugSettings(activeSystem);

    app.ticker.add(() => {
        stats.begin();
        world.step();
        //activeSystem?.step();
        stats.end();
    });
}

startGame()




