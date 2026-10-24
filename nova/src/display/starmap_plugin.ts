import { System } from 'nova_ecs/system';
import { GetWorld, UUID } from 'nova_ecs/arg_types';
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

const MapSystem = new System({
    name: 'MapSystem',
    events: [EcsControlEvent] as const,
    args: [EcsControlEvent, StarmapResource, JumpRouteComponent,
        ScreenSize, GetWorld, UUID, PlayerShipSelector] as const,
    step(controlEvent, starmap, jumpRoute, { x, y }, world, uuid) {
        starmap.container.position.set(x / 2, (y - ((window as any).novaAssets ? 55 : 0)) / 2);
        starmap.container.scale.set(Math.min(1,(x-20)/640,(y - ((window as any).novaAssets ? 90 : 20))/540));
        for (const {action, state} of controlEvent) {
            if (action === 'map' && state === 'start' &&
                !starmap.container.visible) {
                starmap.show([...jumpRoute.route]).then(route => {
                    world.entities.get(uuid)?.components.set(JumpRouteComponent, { route });
                });
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
