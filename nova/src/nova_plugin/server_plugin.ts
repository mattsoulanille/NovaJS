import * as t from 'io-ts';
import { Emit, Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { EntityBuilder } from "nova_ecs/entity";
import { DeleteEvent, EcsEvent } from 'nova_ecs/events';
import { Plugin } from "nova_ecs/plugin";
import { multiplayer, MultiplayerData, PeersEvent } from "nova_ecs/plugins/multiplayer_plugin";
import { EncodedEntity, SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { Query } from "nova_ecs/query";
import { Resource } from 'nova_ecs/resource';
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { v4 } from "uuid";
import { GameDataResource } from "./game_data_resource";
import { makeShip } from "./make_ship";
import { makeSystem, SystemIdResource } from './make_system';
import { MultiRoomResource, SystemComponent } from "./nova_plugin";
import { SystemsResource } from './systems_resource';

export const PlayerData = t.intersection([
    t.type({
        uuid: t.string,
    }),
    t.partial({
        system: t.string,
        ship: EncodedEntity,
    })
]);
export type PlayerData = t.TypeOf<typeof PlayerData>;

const ManageClientsSystem = new System({
    name: 'ManageClients',
    events: [PeersEvent],
    args: [GameDataResource, PeersEvent,
        SystemsResource, SingletonComponent] as const,
    step: async (gameData, peersEvent, systems) => {
        for (const newPeer of peersEvent.addedPeers) {
            // Mock loading saved data
            // TODO: Save and load ships
            const ids = await gameData.ids;
            let randomShip = ids.Ship[Math.floor(Math.random() * ids.Ship.length)];
            const shipData = await gameData.data.Ship.get(randomShip);
            const shipEntity = makeShip(shipData);
            shipEntity.components.set(MultiplayerData, {
                owner: newPeer
            });
            const systemId = 'nova:131';
            const systemWorld = systems.get(systemId)!;
            const serializer = systemWorld.resources.get(SerializerResource)!;
            const encodedShip = serializer.encode(shipEntity);
            // const playerData: PlayerData = {
            //     uuid: newPeer,
            //     system: 'nova:131',
            //     ship: encodedShip,
            // };

            systemWorld.entities.set(v4(), shipEntity);
            console.log(`Ship added to ${systemId} for peer ${newPeer}`);
        }
    }
});

const RemoveMultiplayerEntitiesSystem = new System({
    name: 'RemoveMultiplayerEntitiesSystem',
    events: [PeersEvent],
    args: [PeersEvent, new Query([MultiplayerData, UUID] as const), Entities,
        SingletonComponent] as const,
    step(peersEvent, multiplayerEntities, entities) {
        // Remove entities of peers who have disconnected
        // TODO: Save them for when they reconnect.
        if (peersEvent.removedPeers.size > 0) {
            for (const [multiplayerData, uuid] of multiplayerEntities) {
                if (peersEvent.removedPeers.has(multiplayerData.owner)) {
                    entities.delete(uuid);
                }
            }
        }
    }
});

const PlayerCountResource = new Resource<{ count: number }>('PlayerCountResource');
const SystemEmptyEvent = new EcsEvent('SystemEmptyEvent');

const SystemEmptySystem = new System({
    name: 'SystemEmptySystem',
    events: [DeleteEvent],
    args: [MultiplayerData, PlayerCountResource, SystemIdResource,
        Emit] as const,
    step(multiplayerData, playerCount, id, emit) {
        if (multiplayerData.owner !== 'server') {
            playerCount.count--;
            if (playerCount.count < 0) {
                console.warn(`System ${id} has ${playerCount.count} `
                    + 'multiplayer objects');
                playerCount.count = 0;
            }
            if (playerCount.count === 0) {
                emit(SystemEmptyEvent, undefined);
            }
            console.log(`Player count for ${id} is ${playerCount.count}`);
        }
    }
});

export const ServerPlugin: Plugin = {
    name: 'Server',
    async build(world) {
        const gameData = world.resources.get(GameDataResource);
        if (!gameData) {
            throw new Error('GameDataResource must exist');
        }
        const multiRoom = world.resources.get(MultiRoomResource);
        if (!multiRoom) {
            throw new Error('MultiRoomResource must exist');
        }

        for (const systemId of (await gameData.ids).System) {
            const systemRoom = multiRoom.join(systemId);
            systemRoom.messages.subscribe(async () => {
                if (!world.entities.has(systemId)) {
                    const system = makeSystem(systemId, gameData);
                    world.entities.set(systemId, new EntityBuilder()
                        .addComponent(SystemComponent, system));

                    system.resources.set(PlayerCountResource, { count: 0 });
                    system.addSystem(SystemEmptySystem);

                    system.events.get(SystemEmptyEvent).subscribe(() => {
                        world.entities.delete(systemId);
                        console.log(`Deleted empty system ${systemId}`);
                    });
                    await system.addPlugin(multiplayer(systemRoom));
                }
                // if (peers.size === 0) {
                //     world.entities.delete(systemId);
                // }
            });
        }

        const systems = world.resources.get(SystemsResource);
        if (!systems) {
            throw new Error('Systems resource must be set');
        }
        for (const [, system] of systems) {
            system.addSystem(RemoveMultiplayerEntitiesSystem);
        }

        world.addSystem(ManageClientsSystem);
    }
}
