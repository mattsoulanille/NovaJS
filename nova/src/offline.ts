import type { MultiRoom } from "./communication/multi_room_communicator";
import { BehaviorSubject, Subject } from "rxjs";
import { Entity } from "nova_ecs/entity";
import { Communicator, multiplayer, MultiplayerData, Peers } from "nova_ecs/plugins/multiplayer_plugin";
import { World } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import { v4 } from "uuid";
import { GameData } from "./client/gamedata/GameData";
import { DebugSettings } from "./debug_settings";
import { Display } from "./display/display_plugin";
import { PixiAppResource } from "./display/pixi_app_resource";
import { ResizeEvent } from "./display/screen_size_plugin";
import { Stage } from "./display/stage_resource";
import { GameDataResource } from "./nova_plugin/game_data_resource";
import { FinishJumpEvent } from "./nova_plugin/jump_plugin";
import { makeShip } from "./nova_plugin/make_ship";
import { makeSystem } from "./nova_plugin/make_system";
import { MultiRoomResource, NovaPlugin, SystemComponent } from "./nova_plugin/nova_plugin";
import { PlayerShipSelector } from "./nova_plugin/player_ship_plugin";
import { SystemIdResource } from "./nova_plugin/system_id_resource";


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
    width: window.innerWidth,
    height: window.innerHeight,
    autoDensity: true
});

(window as any).app = app;
document.body.appendChild(app.view as any);

// Keep the ECS multiplayer interface local; no network connection is opened.
const communicator: Communicator = {
    uuid: 'server',
    peers: new Peers(new BehaviorSubject(new Set<string>())),
    servers: new BehaviorSubject(new Set(['server'])),
    connected: new BehaviorSubject(true),
    messages: new Subject<{source: string, message: unknown}>(),
    sendMessage() {},
};
const multiRoom = {
    join: (_id: string) => communicator,
    leave: (_id: string) => {},
};
let world: World;
let system: World | undefined;

async function jumpTo({ entity, to, uuid }: { entity: Entity, to: string, uuid: string }) {
    if (system) {
        system.entities.delete(uuid);
        system.step(); // Let peers know the entity was removed
        const stage = system.resources.get(Stage);
        if (stage) {
            app.stage.removeChild(stage);
        }
        const currentSystemUuid = system.resources.get(SystemIdResource);
        if (currentSystemUuid) {
            world.entities.delete(currentSystemUuid);
            multiRoom.leave(currentSystemUuid);
        }
        await system.removePlugin(Display);
    }

    const newSystem = makeSystem(to, gameData);
    (window as any).novaDebug = new DebugSettings(newSystem, (window as any).novaDebug);

    (window as any).system = newSystem;
    newSystem.resources.set(PixiAppResource, app);
    await newSystem.addPlugin(Display);

    const newStage = newSystem.resources.get(Stage);
    if (!newStage) {
        throw new Error('World did not have Pixi Stage');
    }
    app.stage.addChild(newStage);
    newStage.visible = true;

    const room = multiRoom.join(to);
    await newSystem.addPlugin(multiplayer(room));

    newSystem.events.get(FinishJumpEvent).subscribe(jumpTo);

    world.entities.set(to, new Entity()
        .addComponent(SystemComponent, newSystem));

    newSystem.entities.set(uuid, entity);
    system = newSystem;
}

async function startGame() {
    world = new World();
    world.resources.set(GameDataResource, gameData);
    await world.addPlugin(multiplayer(multiRoom.join('main room')));
    // The offline adapter implements the join/leave surface used by NovaPlugin.
    world.resources.set(MultiRoomResource, multiRoom as unknown as MultiRoom);
    await world.addPlugin(NovaPlugin);

    // Make the player's ship
    const ids = await gameData.ids;
    let randomShip = ids.Ship.includes('nova:128') ? 'nova:128' : ids.Ship[0];
    const shipData = await gameData.data.Ship.get(randomShip);
    const shipEntity = makeShip(shipData);
    shipEntity.components.set(MultiplayerData, {
        owner: communicator.uuid!
    });
    shipEntity.components.set(PlayerShipSelector, undefined);
    const systemId = 'nova:130';

    await jumpTo({
        entity: shipEntity,
        to: systemId,
        uuid: v4(),
    });

    (window as any).world = world;

    function resize() {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        system?.emit(ResizeEvent, { x: window.innerWidth, y: window.innerHeight });
    }
    window.onresize = resize;




    app.ticker.add(() => {

        world.step();

    });
}

startGame().then(()=>{document.getElementById("loading")?.remove();}).catch((e)=>{(window as any).showError(e);});
