import * as t from 'io-ts';
import { Entities, UUID } from 'nova_ecs/arg_types';
import { Entity } from "nova_ecs/entity";
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from "nova_ecs/plugin";
import { CommunicatorResource, multiplayer, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { EncodedEntity } from "nova_ecs/plugins/serializer_plugin";
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { Subscription } from 'rxjs';
import { GameDataResource } from "./game_data_resource";
import { makeSystem } from './make_system';
import { MultiRoomResource, SystemComponent } from "./nova_plugin";

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

const RemovedPeerEvent = new EcsEvent<string>('RemovedPeerEvent');

export const ManageClientsSystem = new System({
    name: 'ManageClients',
    events: [RemovedPeerEvent],
    args: [RemovedPeerEvent, new Query([MultiplayerData, UUID] as const),
        Entities, SingletonComponent] as const,
    step: (removedPeer, multiplayerEntities, entities) => {
        // Remove entities of peers who have disconnected
        // TODO: Save them for when they reconnect.
        for (const [multiplayerData, uuid] of multiplayerEntities) {
            if (multiplayerData.owner === removedPeer) {
                entities.delete(uuid);
            }
        }
    }
});

const LeaveSubscription = new Resource<Subscription>('LeaveSubscription');

const ServerSystemPlugin: Plugin = {
    name: 'ServerSystemPlugin',
    build(world) {
        const communicator = world.resources.get(CommunicatorResource);
        if (!communicator) {
            throw new Error('Expected CommunicatorResource to exist');
        }
        world.addSystem(ManageClientsSystem);
        const subscription = communicator.peers.leave.subscribe(peer => {
            console.log(`${peer} left`);
            world.emit(RemovedPeerEvent, peer);
        });
        world.resources.set(LeaveSubscription, subscription);
    },
    remove(world) {
        world.resources.get(LeaveSubscription)?.unsubscribe();
    }
}

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
            systemRoom.peers.current.subscribe(async peers => {
                // Delete systems that have no (non-server) peers.
                const empty = [...peers].every(v => systemRoom.servers.value.has(v));
                if (empty) {
                    let cleanupPromise: Promise<void> | undefined;
                    if (world.entities.has(systemId)) {
                        console.log(`Deleting empty system ${systemId}`);
                        cleanupPromise = world.entities.get(systemId)!
                            .components.get(SystemComponent)?.removeAllPlugins();
                    }
                    world.entities.delete(systemId);
                    await cleanupPromise;
                } else {
                    // Create the system if it doesn't exist yet.
                    if (!world.entities.has(systemId)) {
                        const system = makeSystem(systemId, gameData);
                        world.entities.set(systemId, new Entity()
                            .addComponent(SystemComponent, system));

                        console.log(`Created system ${systemId}`);
                        await system.addPlugin(multiplayer(systemRoom,
                            message => `System ${systemId}: ${message}`));
                        await system.addPlugin(ServerSystemPlugin);
                    }
                }
            });
        }
    }
}
