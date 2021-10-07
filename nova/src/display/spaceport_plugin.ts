import { Entities, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { Provide } from 'nova_ecs/provider';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { currentIfDraft } from 'nova_ecs/utils';
import { Without } from 'nova_ecs/without';
import { GameData } from '../client/gamedata/GameData';
import { ControlsSubject } from '../nova_plugin/controls_plugin';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { LandEvent, PlanetComponent } from '../nova_plugin/planet_plugin';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin';
import { Spaceport } from '../spaceport/spaceport';
import { ResizeEvent, ScreenSize } from './screen_size_plugin';
import { Stage } from './stage_resource';


const SpaceportComponent = new Component<Spaceport>("Spaceport");

function deImmerify(entity: Entity) {
    for (const [component, value] of entity.components) {
        entity.components.set(component, currentIfDraft(value));
    }
}

const SpaceportProvider = Provide({
    name: "SpaceportProvider",
    provided: SpaceportComponent,
    args: [GameDataResource, ControlsSubject, Stage, PlanetComponent] as const,
    factory(gameData, controls, stage, { id }) {
        const spaceport = new Spaceport(gameData as GameData, id, controls);
        stage.addChild(spaceport.container);
        return spaceport;
    }
});

const SpaceportQuery = new Query([SpaceportComponent] as const);

const LandSystem = new System({
    name: 'LandSystem',
    events: [LandEvent],
    args: [LandEvent, UUID, Entities, RunQuery, ScreenSize, PlayerShipSelector] as const,
    step({ uuid }, shipUuid, entities, runQuery, { x, y }) {
        const spaceport = runQuery(SpaceportQuery, uuid)[0]?.[0];
        if (!spaceport) {
            return;
        }

        const playerShip = entities.get(shipUuid);
        if (!playerShip) {
            console.warn('Player ship is missing? Cannot land.');
            return;
        }
        entities.delete(shipUuid);
        deImmerify(playerShip);

        spaceport.container.position.x = x / 2;
        spaceport.container.position.y = y / 2;
        spaceport.show(playerShip).then(newShip => {
            entities.set(shipUuid, newShip);
        });
    }
});

const SpaceportResizeSystem = new System({
    name: 'SpaceportResize',
    events: [ResizeEvent],
    args: [ResizeEvent, SpaceportComponent] as const,
    step({ x, y }, spaceport) {
        spaceport.container.position.x = x / 2;
        spaceport.container.position.y = y / 2;
    }
});

export const SpaceportPlugin: Plugin = {
    name: 'SpaceportPlugin',
    build(world) {
        world.addSystem(SpaceportProvider);
        world.addSystem(LandSystem);
        world.addSystem(SpaceportResizeSystem);
    }
}
