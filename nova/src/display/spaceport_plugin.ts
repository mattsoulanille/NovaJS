import { Emit, Entities, GetEntity, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { CommunicatorResource, MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { Provide } from 'nova_ecs/provider';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { GameData } from '../client/gamedata/GameData';
import { ControlsSubject } from '../nova_plugin/controls_plugin';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { LandEvent, PlanetComponent } from '../nova_plugin/planet_plugin';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin';
import { Spaceport } from '../spaceport/spaceport';
import { deImmerify } from '../util/deimmerify';
import { ResizeEvent, ScreenSize } from './screen_size_plugin';
import { Stage } from './stage_resource';


const SpaceportComponent = new Component<Spaceport>("Spaceport");

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
    args: [LandEvent, UUID, Entities, RunQuery, ScreenSize, GetEntity, Optional(CommunicatorResource), PlayerShipSelector] as const,
    step({ uuid }, shipUuid, entities, runQuery, { x, y }, playerShip, communicator) {
        const spaceport = runQuery(SpaceportQuery, uuid)[0]?.[0];
        if (!spaceport) {
            return;
        }

        entities.delete(shipUuid);
        deImmerify(playerShip);

        spaceport.container.position.x = x / 2;
        spaceport.container.position.y = y / 2;
        spaceport.show(playerShip).then(newShip => {
            if (communicator?.uuid) {
                newShip.components.set(MultiplayerData, {
                    owner: communicator.uuid,
                });
            }
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
    },
    remove(world) {
        world.removeSystem(SpaceportProvider);
        world.removeSystem(LandSystem);
        world.removeSystem(SpaceportResizeSystem);
    }
}
