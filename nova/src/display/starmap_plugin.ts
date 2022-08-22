import { AsyncSystem } from 'nova_ecs/async_system';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { GameData } from '../client/gamedata/GameData';
import { ControlsSubject, EcsControlEvent } from '../nova_plugin/controls_plugin';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { JumpRouteComponent } from '../nova_plugin/jump_plugin';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin';
import { SystemIdResource } from '../nova_plugin/system_id_resource';
import { Starmap } from '../spaceport/starmap';
import { ScreenSize } from './screen_size_plugin';
import { Stage } from './stage_resource';

const StarmapResource = new Resource<Starmap>("Starmap");

const MapSystem = new AsyncSystem({
    name: 'MapSystem',
    events: [EcsControlEvent] as const,
    exclusive: true,
    alwaysRunOnEvents: false,
    skipIfApplyingPatches: true,
    args: [EcsControlEvent, StarmapResource, JumpRouteComponent,
        ScreenSize, PlayerShipSelector] as const,
    async step(controlEvent, starmap, jumpRoute, { x, y }) {
        starmap.container.position.set(x / 2, y / 2);
        for (const {action, state} of controlEvent) {
            if (action === 'map' && state === 'start' &&
                !starmap.container.visible) {
                jumpRoute.route = await starmap.show(jumpRoute.route);
            }
        }
    }
});

export const StarmapPlugin: Plugin = {
    name: 'StarmapPlugin',
    build(world) {
        const gameData = world.resources.get(GameDataResource);
        if (!gameData) {
            throw new Error('Expected GameDataResource to exist');
        }
        const controls = world.resources.get(ControlsSubject);
        if (!controls) {
            throw new Error('Expected ControlsSubject to exist');
        }
        const stage = world.resources.get(Stage);
        if (!stage) {
            throw new Error('Expected Stage to exist');
        }
        const systemId = world.resources.get(SystemIdResource);
        if (!systemId) {
            throw new Error('Expected SystemIdResource to exist');
        }

        const starmap = new Starmap(gameData as GameData, systemId, controls);
        stage.addChild(starmap.container);
        world.resources.set(StarmapResource, starmap);

        world.addSystem(MapSystem);
    },
    remove(world) {
        world.removeSystem(MapSystem);
        const stage = world.resources.get(Stage);
        const starmap = world.resources.get(StarmapResource);
        if (stage && starmap) {
            stage.removeChild(starmap.container);
        }
        world.resources.delete(StarmapResource);
    }
}
