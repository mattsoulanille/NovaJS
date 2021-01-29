import { isDraft, original } from "immer";
import { Component } from "novajs/nova_ecs/component";
import { System } from "novajs/nova_ecs/system";
import { Entities, UUID } from "nova_ecs/arg_types";
import { AsyncSystem } from "nova_ecs/async_system";
import { Plugin } from "nova_ecs/plugin";
import { Comms, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { Query } from "nova_ecs/query";
import { v4 } from "uuid";
import { setDifference } from "../common/SetUtils";
import { GameDataResource } from "./game_data_resource";
import { makeShip } from "./make_ship";


export const PeersChanged = new Component<{
    newPeers: Set<string>,
    removedPeers: Set<string>,
}>({ name: 'PeersChanged' });

// This computation can't be done in AsyncSystem because
// arguments to it are frozen, so 'original' doesn't work.
export const peersChangedSystem = new System({
    name: 'PeersChanged',
    args: [Comms, PeersChanged] as const,
    step: (comms, peersChanged) => {
        const originalPeers = original(comms)?.peers ?? comms.peers;
        peersChanged.newPeers = setDifference(comms.peers, originalPeers);
        peersChanged.removedPeers = setDifference(originalPeers, comms.peers);
    },
    after: ['ApplyChanges'],
})

export const manageClientsSystem = new AsyncSystem({
    name: 'ManageClients',
    args: [Comms, PeersChanged, GameDataResource,
        new Query([MultiplayerData, UUID] as const), Entities] as const,
    step: async (comms, peersChanged, gameData, multiplayerEntities, entities) => {
        if (!isDraft(comms)) {
            // Then there's no way we have new peers since
            // peers can only be added by drafting
            return;
        }

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
        for (const newPeer of peersChanged.newPeers) {
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
    after: ['ApplyChanges', peersChangedSystem],
    before: ['SendChanges'],
});


export const ServerPlugin: Plugin = {
    name: 'Server',
    build(world) {
        world.addSystem(manageClientsSystem);
        world.addSystem(peersChangedSystem);
        world.singletonEntity.components.set(PeersChanged, {
            newPeers: new Set<string>(),
            removedPeers: new Set<string>(),
        });
    }
}
