import * as t from 'io-ts';
import { EntityBuilder } from "nova_ecs/entity";
import { Plugin } from "nova_ecs/plugin";
import { multiplayer } from "nova_ecs/plugins/multiplayer_plugin";
import { EncodedEntity } from "nova_ecs/plugins/serializer_plugin";
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

export const ServerPlugin: Plugin = {
    name: 'Server',
    async build(world) {
        console.log('esrver plugin');
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
                    if (world.entities.has(systemId)) {
                        console.log(`Deleting empty system ${systemId}`);
                    }
                    world.entities.delete(systemId);
                } else {
                    // Create the system if it doesn't exist yet.
                    if (!world.entities.has(systemId)) {
                        const system = makeSystem(systemId, gameData);
                        world.entities.set(systemId, new EntityBuilder()
                            .addComponent(SystemComponent, system));

                        console.log(`Created system ${systemId}`);
                        await system.addPlugin(multiplayer(systemRoom,
                            message => `System ${systemId}: ${message}`));
                    }
                }
            });
        }
    }
}
