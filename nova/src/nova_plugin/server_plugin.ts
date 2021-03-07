import { SingletonComponent } from "nova_ecs/world";
import { Entities, UUID } from "nova_ecs/arg_types";
import { AsyncSystem } from "nova_ecs/async_system";
import { Plugin } from "nova_ecs/plugin";
import { MultiplayerData, PeersChanged } from "nova_ecs/plugins/multiplayer_plugin";
import { Query } from "nova_ecs/query";
import { v4 } from "uuid";
import { GameDataResource } from "./game_data_resource";
import { makeShip } from "./make_ship";


export const manageClientsSystem = new AsyncSystem({
    name: 'ManageClients',
    events: [PeersChanged], // TODO: Fix async systems that use events.
    args: [GameDataResource, PeersChanged, new Query([MultiplayerData, UUID] as const),
        Entities, SingletonComponent] as const,
    step: async (gameData, peersChanged, multiplayerEntities, entities) => {
        // Remove entities of peers who have disconnected
        // TODO: Save them for when they reconnect.
        if (peersChanged.removedPeers.size > 0) {
            for (const [multiplayerData, uuid] of multiplayerEntities) {
                if (peersChanged.removedPeers.has(multiplayerData.owner)) {
                    entities.delete(uuid);
                }
            }
        }

        // TODO: Give them back the entitiy they disconnected with.
        for (const newPeer of peersChanged.addedPeers) {
            console.log(`Adding ship for peer ${newPeer}`);
            const ids = await gameData.ids;
            const randomShip = ids.Ship[Math.floor(Math.random() * ids.Ship.length)];
            const shipData = await gameData.data.Ship.get(randomShip);
            const shipEntity = makeShip(shipData);
            shipEntity.components.set(MultiplayerData, {
                owner: newPeer
            });
            entities.set(v4(), shipEntity);
            console.log(`Ship added for peer ${newPeer}`);
        }
    },
});


export const ServerPlugin: Plugin = {
    name: 'Server',
    build(world) {
        world.addSystem(manageClientsSystem);
    }
}
