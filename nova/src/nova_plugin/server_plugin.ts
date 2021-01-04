import { isDraft, original } from "immer";
import { Commands, UUID } from "../ecs/arg_types";
import { Plugin } from "../ecs/plugin";
import { Comms, MultiplayerData } from "../ecs/plugins/multiplayer_plugin";
import { Query } from "../ecs/query";
import { System } from "../ecs/system";
import { setDifference } from "../ecs/utils";
import { GameDataResource } from "./game_data_resource";
import { makeShip } from "./make_ship";


export const manageClientsSystem = new System({
    name: 'ManageClients',
    args: [Comms, GameDataResource, new Query([MultiplayerData, UUID] as const),
        Commands] as const,
    step: (comms, _gameData, entities, commands) => {
        if (!isDraft(comms)) {
            // Then there's no way we have new peers since
            // peers can only be added by drafting
            return;
        }

        const originalPeers = original(comms)?.peers ?? comms.peers;
        const newPeers = setDifference(comms.peers, originalPeers);
        const removedPeers = setDifference(originalPeers, comms.peers);

        // Remove entities of peers who have disconnected
        // TODO: Save them for when they reconnect.
        if (removedPeers.size > 0) {
            for (const [multiplayerData, uuid] of entities) {
                if (removedPeers.has(multiplayerData.owner)) {
                    commands.removeEntity(uuid);
                }
            }
        }

        // TODO: Give them back the entitiy they disconnected with.
        for (const newPeer of newPeers) {
            console.log(`TODO: Add ship for peer ${newPeer}`);
            // const ids = await gameData.ids;
            // const randomShip = ids.Ship[Math.floor(Math.random() * ids.Ship.length)];
            // const shipData = await gameData.data.Ship.get(randomShip);
            // const shipEntity = makeShip(shipData);
            // shipEntity.addComponent(MultiplayerData, {
            //     owner: newPeer
            // });
            // commands.addEntity(shipEntity);
        }
    },
    after: ['ApplyChanges'],
    before: ['SendChanges'],
});


export const ServerPlugin: Plugin = {
    name: 'Server',
    build(world) {
        world.addSystem(manageClientsSystem);
    }
}
