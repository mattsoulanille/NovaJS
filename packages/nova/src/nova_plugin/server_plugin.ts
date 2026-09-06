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
import { hashWorld } from "nova_ecs/plugins/world_hash";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { RollbackRelay } from "../communication/rollback_relay.js";
import { RoomArchive } from "../communication/room_archive.js";
import { DesyncRecorder, fingerprintGameData } from "../server/desync_recorder.js";
import { PEER_LOCAL_COMPONENTS } from "./ship_control.js";
import { SimulationGameDataResource } from "./game_data_resource.js";
import { makeSystem } from './make_system.js';
import { MultiRoomResource, SystemComponent } from "./nova_plugin.js";

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
        // Remove entities of peers who have disconnected. Tracker issue:
        // keep them for a reconnecting peer instead.
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
        const gameData = world.resources.get(SimulationGameDataResource);
        if (!gameData) {
            throw new Error('SimulationGameDataResource must exist');
        }
        const multiRoom = world.resources.get(MultiRoomResource);
        if (!multiRoom) {
            throw new Error('MultiRoomResource must exist');
        }

        // Rooms are pure input exchanges: the server is not a
        // simulation *authority* for them. Each active room gets a
        // RollbackRelay (input relay, tick clock, input archive) plus a
        // RoomArchive: a trailing sim of the room's deterministic
        // world, wire-snapshotted periodically so joiners reconstruct
        // from a recent baseline plus the log tail rather than
        // replaying from genesis.
        const relays = new Map<string, RollbackRelay>();
        const archives = new Map<string, RoomArchive>();
        // The black-box recorder: every desync conviction becomes a
        // timestamped directory under desyncs/ for offline analysis.
        const desyncRecorder = new DesyncRecorder();
        desyncRecorder.gameDataFingerprint =
            fingerprintGameData(await gameData.ids);
        for (const systemId of (await gameData.ids).System) {
            const systemRoom = multiRoom.join(systemId);
            systemRoom.peers.current.subscribe(peers => {
                const empty = [...peers].every(v => systemRoom.servers.value.has(v));
                if (empty) {
                    if (relays.has(systemId)) {
                        console.log(`Closing rollback room ${systemId}`);
                        archives.get(systemId)?.close();
                        archives.delete(systemId);
                        relays.get(systemId)?.close();
                        relays.delete(systemId);
                    }
                } else if (!relays.has(systemId)) {
                    console.log(`Starting rollback room ${systemId}`);
                    const relay = new RollbackRelay(systemRoom, {
                        baseline: () => archives.get(systemId)?.latest,
                        // Resyncs reconstruct from a baseline captured
                        // now: the log tail shrinks from up-to-30s to
                        // the transit window, making recovery ~200ms
                        // instead of a 1-2s rebuild hiccup.
                        freshBaseline: () =>
                            archives.get(systemId)?.captureState(),
                        referenceHash: tick =>
                            archives.get(systemId)?.hashAt(tick),
                        // Diagnostics for the unresolved archive-vs-
                        // everyone divergence: dump the archive's view
                        // so it can be diffed against novaSim.hashes()
                        // from a client.
                        onArchiveOutvoted: () => {
                            const world = archives.get(systemId)?.archiveWorld;
                            if (!world) {
                                return;
                            }
                            const hashes = hashWorld(world, PEER_LOCAL_COMPONENTS);
                            console.error(`Archive world (tick ${world.resources
                                .get(TimeResource)?.frame}):`,
                                Object.fromEntries(hashes.entities));
                        },
                        onDesync: info => {
                            desyncRecorder.recordDesync(systemId, info, {
                                baselines:
                                    archives.get(systemId)?.baselines() ?? [],
                                log: relays.get(systemId)?.inputLog ?? [],
                                archiveEntityHashes: archives.get(systemId)
                                    ?.entityHashesAt(info.tick),
                                archiveState: archives.get(systemId)
                                    ?.captureState(),
                            });
                        },
                        onDesyncDump: (peerId, dump) => {
                            desyncRecorder.recordClientDump(
                                systemId, peerId, dump);
                        },
                    });
                    relays.set(systemId, relay);
                    archives.set(systemId, new RoomArchive(relay,
                        () => makeSystem(systemId, gameData, 'node'),
                        { name: systemId }));
                }
            });
        }
    }
}
