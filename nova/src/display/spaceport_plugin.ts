import { Entities, UUID } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { currentIfDraft } from 'nova_ecs/utils';
import { SingletonComponent } from 'nova_ecs/world';
import { GameData } from '../client/gamedata/GameData';
import { ControlsSubject } from '../nova_plugin/controls_plugin';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { LandEvent } from '../nova_plugin/planet_plugin';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin';
import { Spaceport } from '../spaceport/spaceport';
import { ResizeEvent } from './resize_event';
import { ScreenSize } from './screen_size_plugin';
import { Stage } from './stage_resource';


const SpaceportResource = new Resource<{ spaceport?: Spaceport }>("Spaceport");

function deImmerify(entity: Entity) {
    for (const [component, value] of entity.components) {
        entity.components.set(component, currentIfDraft(value));
    }
}

const LandSystem = new System({
    name: 'LandSystem',
    events: [LandEvent],
    args: [LandEvent, GameDataResource, UUID, Entities, ControlsSubject,
        Stage, SpaceportResource, ScreenSize, PlayerShipSelector] as const,
    step({ id }, gameData, uuid, entities, controlsSubject, stage,
        spaceportResource, { x, y }) {
        const playerShip = entities.get(uuid);
        if (!playerShip) {
            console.warn('Player ship is missing? Cannot land.');
            return;
        }
        entities.delete(uuid);
        deImmerify(playerShip);

        const spaceport = new Spaceport(gameData as GameData, id, playerShip,
            controlsSubject, (newShip) => {
                entities.set(uuid, newShip);
                stage.removeChild(spaceport.container);
            });
        spaceport.container.position.x = x / 2;
        spaceport.container.position.y = y / 2;

        stage.addChild(spaceport.container);

        spaceportResource.spaceport = spaceport;
    }
});

const SpaceportResizeSystem = new System({
    name: 'SpaceportResize',
    events: [ResizeEvent],
    args: [ResizeEvent, SpaceportResource, SingletonComponent] as const,
    step({ x, y }, { spaceport }) {
        if (spaceport) {
            spaceport.container.position.x = x / 2;
            spaceport.container.position.y = y / 2;
        }
    }
});

export const SpaceportPlugin: Plugin = {
    name: 'SpaceportPlugin',
    build(world) {
        world.resources.set(SpaceportResource, {});
        world.addSystem(LandSystem);
        world.addSystem(SpaceportResizeSystem);
    }
}
