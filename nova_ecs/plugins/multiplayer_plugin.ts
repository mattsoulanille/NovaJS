import { isLeft } from 'fp-ts/lib/Either';
import produce from 'immer';
import * as t from 'io-ts';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { Emit, Entities, GetEntity, UUID } from '../arg_types';
import { Component } from '../component';
import { map } from '../datatypes/map';
import { set } from '../datatypes/set';
import { EcsEvent } from '../events';
import { Plugin } from '../plugin';
import { Query } from '../query';
import { Resource } from '../resource';
import { System } from '../system';
import { DefaultMap, setDifference } from '../utils';
import { World } from '../world';
import { DeltaPlugin, DeltaResource, EntityDelta } from './delta_plugin';
import { EncodedEntity, SerializerResource } from './serializer_plugin';

export class Peers {
    readonly current: BehaviorSubject<Set<string>>;
    readonly join: Subject<string>;
    readonly leave: Subject<string>;

    constructor(p: BehaviorSubject<Set<string>> | {
        join: Subject<string>;
        leave: Subject<string>;
        initial?: Set<string>;
    }) {
        if (p instanceof BehaviorSubject) {
            this.current = p;
            const join = new Subject<string>();
            this.join = join;
            const leave = new Subject<string>();
            this.leave = leave;
            let lastPeers = new Set([...p.value]);
            p.subscribe(peers => {
                const joined = setDifference(peers, lastPeers);
                const left = setDifference(lastPeers, peers);
                for (const peer of joined) {
                    join.next(peer);
                }
                for (const peer of left) {
                    leave.next(peer);
                }
                lastPeers = new Set([...peers]);
            });
        } else {
            const { join, leave, initial } = p;
            this.current = new BehaviorSubject(initial ?? new Set());
            join.subscribe(peer => {
                this.current.next(produce(this.current.value, peers => {
                    peers.add(peer)
                }));
            });
            leave.subscribe(peer => {
                this.current.next(produce(this.current.value, peers => {
                    peers.delete(peer)
                }));
            });
            this.join = join;
            this.leave = leave;
        }
    }
}

export interface Communicator {
    uuid: string | undefined;
    peers: Peers,
    servers: BehaviorSubject<Set<string>>,
    messages: Observable<{ source: string, message: unknown }>,
    connected: BehaviorSubject<boolean>,
    sendMessage(message: unknown, destination?: string | Set<string>): void;
}

export const Message = t.partial({
    delta: map(t.string /* Entity UUID */, EntityDelta),
    state: map(t.string /* Entity UUID */, EncodedEntity),
    requestState: t.type({
        uuids: set(t.string),
        invert: t.boolean,
    }),
    remove: t.array(t.string),
    ownedUuids: t.array(t.string),
    admins: set(t.string),
    peers: set(t.string),
});
export type Message = t.TypeOf<typeof Message>;

export const MultiplayerData = new Component<{ owner: string }>('MultiplayerData');

export interface MessageWithSource<M> {
    message: M,
    source: string,
}

export const Comms = new Component<{
    ownedUuids: Set<string>,
    admins: Set<string>,
    uuid: string | undefined,
    stateRequests: Map<string /* peer uuid */, Set<string /* Entity uuid */>>,
    lastEntities: Map<string, string>, // entity, owner
    messages: MessageWithSource<Message>[],
    initialStateRequested: boolean,
}>('Comms');


export const NewOwnedEntityEvent = new EcsEvent<string>('NewOwnedEntityEvent');

export const MultiplayerMessageEvent =
    new EcsEvent<MessageWithSource<unknown>>('MultiplayerMessageEvent');
const MessageSystem = new System({
    name: 'MessageSystem',
    events: [MultiplayerMessageEvent],
    args: [MultiplayerMessageEvent, Comms] as const,
    step: ({ message, source }, comms) => {
        const maybeMessage = Message.decode(message);
        if (isLeft(maybeMessage)) {
            console.warn('Failed to decode message');
            return;
        }
        comms.messages.push({ message: maybeMessage.right, source });
    }
});

export const CommunicatorResource = new Resource<Communicator>('CommunicatorResource');

export function multiplayer(communicator: Communicator,
    warn: (message: string) => void = console.warn): Plugin {
    const MultiplayerQuery = new Query([UUID, GetEntity, MultiplayerData] as const);

    const multiplayerSystem = new System({
        name: 'Multiplayer',
        args: [MultiplayerQuery, Entities, Comms,
            DeltaResource, SerializerResource, Emit] as const,
        step: (query, entities, comms, deltaMaker, serializer, emit) => {
            if (comms.uuid && communicator.uuid && comms.uuid !== communicator.uuid) {
                // Change the owner of all entities owned by our previous uuid
                // to our current uuid.
                for (const [, , multiplayerData] of query) {
                    if (multiplayerData.owner === comms.uuid) {
                        multiplayerData.owner = communicator.uuid;
                    }
                }
            }

            comms.uuid = communicator.uuid;
            if (!comms.uuid) {
                // Can't do anything if we don't have a uuid.
                return;
            }

            const isAdmin = comms.admins.has(comms.uuid);

            function randomAdmin() {
                return [...comms.admins][Math.floor(Math.random() * comms.admins.size)];
            }

            // Request initial state
            if (!comms.initialStateRequested) {
                const admin = randomAdmin();
                if (admin) {
                    sendMessage({
                        requestState: {
                            uuids: new Set(),
                            invert: true,
                        }
                    }, admin);
                    comms.initialStateRequested = true;
                }
            }

            function sendMessage(message: Message, destination?: string) {
                communicator.sendMessage(Message.encode(message), destination);
            }

            const entityMap = new Map(query.map(([uuid, entity, data]) =>
                [uuid, { entity, data }]));
            const entityUuids = new Set(entityMap.keys());

            // Entities to request the full state of
            // keyed by who to ask for them.
            const fullStateRequests = new DefaultMap<string, Set<string>>(() => new Set());

            // Track entities added and removed
            const added = new Map<string, string>();
            const removed = new Set<string>();

            // Apply changes from messages
            for (const { source, message } of comms.messages) {
                const peerIsAdmin = comms.admins.has(source);

                // Set admins
                if (peerIsAdmin && message.admins) {
                    comms.admins = message.admins;
                }

                // Send requested states
                if (message.requestState) {
                    let uuidsToSend: string[];
                    if (message.requestState.invert) {
                        uuidsToSend = [...setDifference(entityUuids, message.requestState.uuids)];
                    } else {
                        uuidsToSend = [...message.requestState.uuids].filter(
                            uuid => entityUuids.has(uuid));
                    }

                    const state = new Map(uuidsToSend.map(entityUuid => {
                        const entry = entityMap.get(entityUuid);
                        if (!entry) {
                            // They have already been filtered above, so this would
                            // be an error.
                            throw new Error(`Expected entity ${entityUuid} to exist`);
                        }
                        const { entity } = entry;
                        return [entityUuid, serializer.encode(entity)]
                    }));

                    sendMessage({ state }, source);
                }

                // Remove entities
                for (const uuid of message.remove ?? []) {
                    // if (entityMap.has(uuid) &&
                    //     (entityMap.get(uuid)?.data.owner === source || peerIsAdmin)) {
                        entities.delete(uuid);
                        fullStateRequests.delete(uuid);
                        added.delete(uuid);
                        removed.add(uuid);
                        entityMap.delete(uuid);
                    //} else {
                        //warn(`'${source}' tried to remove ${uuid}`);
                    //}
                }

                // Add new entities
                for (const [uuid, encodedEntity] of message.state ?? []) {
                    const maybeEntity = serializer.decode(encodedEntity);
                    if (isLeft(maybeEntity)) {
                        warn(`Failed to decode entity: ${maybeEntity.left}`);
                        continue;
                    }
                    const entity = maybeEntity.right;

                    const multiplayerData = entity.components.get(MultiplayerData);
                    if (!multiplayerData) {
                        warn(`New entity '${uuid}' missing MultiplayerData`);
                        continue;
                    }
                    // if (entityMap.has(uuid)
                    //     && entityMap.get(uuid)?.data.owner !== source
                    //     && !peerIsAdmin) {
                    //     warn(`'${source}' tried to replace existing entity '${uuid}'`);
                    //     continue;
                    // }

                    entities.set(uuid, entity);
                    added.set(uuid, multiplayerData.owner);
                    removed.delete(uuid);

                    // Add the newly added entity to the entityMap so we don't
                    // accidentally request its state in `apply deltas`.
                    const handle = entities.get(uuid)!;
                    entityMap.set(uuid, { entity: handle, data: multiplayerData });

                    // If the new entity is owned by us, emit that fact.
                    if (multiplayerData.owner === comms.uuid) {
                        emit(NewOwnedEntityEvent, uuid);
                    }
                }

                // Set UUIDs
                if (message.ownedUuids) {
                    comms.ownedUuids = new Set(message.ownedUuids);
                }

                // Apply deltas
                for (const [uuid, entityDelta] of message.delta ?? []) {
                    if (!entityMap.has(uuid)) {
                        fullStateRequests.get(source).add(uuid);
                        continue;
                    }
                    const { entity, data } = entityMap.get(uuid)!;

                    // if (source !== data.owner && !comms.admins.has(source)) {
                    //     warn(`'${source}' tried to modify entity '${uuid}'`);
                    //     continue;
                    // }
                    try {
                        deltaMaker.applyDelta(entity, entityDelta);
                    } catch (e) {
                        console.warn(`Failed to apply delta to ${uuid}`);
                        console.warn(e);
                    }
                }
            }
            // Reset messages since they've been processed.
            comms.messages = [];

            if (fullStateRequests.size > 0) {
                // Request state from a (maybe) trusted source
                for (const [source, uuids] of fullStateRequests) {
                    sendMessage({
                        requestState: {
                            uuids, invert: false,
                        }
                    }, source);
                }
            }
            const currentOwners = new Map([...entityMap].map(([uuid, val]) =>
                [uuid, val.data.owner]));
            const entityOwners = new Map([
                ...currentOwners,
                ...comms.lastEntities,
            ]);

            // Entities added by us in the current step
            const addedEntities = setDifference(entityUuids,
                new Set([...comms.lastEntities.keys(), ...added.keys()]));
            // Entities removed by us in the current step
            const removedEntities = setDifference(
                new Set([...comms.lastEntities.keys()]),
                new Set([...entityUuids, ...removed]));
            // Update the set of last seen entities.
            comms.lastEntities = new Map([
                ...currentOwners,
                ...added,
            ]);

            const delta = new Map<string, EntityDelta>();
            const state = new Map<string, EncodedEntity>();
            let ownedUuids: string[] = [];
            const remove = [...removedEntities].filter(entityUuid =>
                entityOwners.get(entityUuid) === comms.uuid || isAdmin);

            // Send states for new entities
            for (const uuid of addedEntities) {
                const val = entityMap.get(uuid);
                if (!val) {
                    throw new Error(`Expected to have entity ${uuid}`);
                }
                const { entity } = val;

                state.set(uuid, serializer.encode(entity));
            }

            // Get deltas and create drafts 
            for (const [uuid, entity, multiplayerData] of query) {
                if (multiplayerData.owner !== comms.uuid) {
                    continue;
                }
                const entityDelta = deltaMaker.getDelta(entity);
                if (entityDelta) {
                    delta.set(uuid, entityDelta);
                }
            }

            const changes: Message = {};

            let send = false;
            if (delta.size > 0) {
                changes.delta = delta;
                send = true;
            }
            if (state.size > 0) {
                changes.state = state;
                send = true;
            }
            if (remove.length > 0) {
                changes.remove = remove;
                send = true;
            }
            if (ownedUuids.length > 0) {
                changes.ownedUuids = ownedUuids;
                send = true;
            }

            if (send) {
                // Only send if there's something to send.
                sendMessage(changes);
            }
        }
    });

    function build(world: World) {
        world.addPlugin(DeltaPlugin);
        world.resources.set(CommunicatorResource, communicator);
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        deltaMaker.addComponent(MultiplayerData, {
            componentType: t.type({
                owner: t.string,
            })
        });

        world.addSystem(multiplayerSystem);
        world.addSystem(MessageSystem);
        world.addComponent(MultiplayerData);
        world.singletonEntity.components.set(Comms, {
            ownedUuids: new Set<string>(),
            uuid: communicator.uuid,
            admins: new Set<string>(['server']),
            lastEntities: new Map<string, string>(),
            stateRequests: new Map(),
            messages: [],
            initialStateRequested: false,
        });

        communicator.messages.subscribe(message => {
            world.emit(MultiplayerMessageEvent, message);
        });
    }

    return {
        name: 'multiplayer',
        build
    }
}

