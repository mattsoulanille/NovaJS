import { isLeft } from 'fp-ts/lib/Either';
import { createDraft, current, Draft, finishDraft, isDraft, original } from 'immer';
import { Objectish } from 'immer/dist/internal';
import * as t from 'io-ts';
import { BehaviorSubject, Observable } from 'rxjs';
import { Components, Emit, Entities, GetEntity, UUID } from '../arg_types';
import { Component } from '../component';
import { map } from '../datatypes/map';
import { set } from '../datatypes/set';
import { Entity, EntityBuilder } from '../entity';
import { EcsEvent } from '../events';
import { Plugin } from '../plugin';
import { Query } from '../query';
import { Resource } from '../resource';
import { System } from '../system';
import { setDifference } from '../utils';
import { SingletonComponent, World } from '../world';

export interface Communicator {
    uuid: string | undefined;
    peers: BehaviorSubject<Set<string>>,
    messages: Observable<unknown>,
    sendMessage(message: unknown, destination?: string): void;
}

const EntityState = t.type({
    state: map(t.string /* Component Name */, t.unknown /* State */),
    owner: t.string,
})
type EntityState = t.TypeOf<typeof EntityState>;
const EntityDelta = map(t.string /* Component Name */, t.unknown /* Delta */);
type EntityDelta = t.TypeOf<typeof EntityDelta>;

export const Message = t.intersection([t.type({
    source: t.string, // UUID of the client or server the message came from.
}), t.partial({
    delta: map(t.string /* Entity UUID */, EntityDelta),
    state: map(t.string /* Entity UUID */, EntityState),
    requestState: t.array(t.string),
    remove: t.array(t.string),
    ownedUuids: t.array(t.string),
    admins: set(t.string),
    peers: set(t.string),
})]);
export type Message = t.TypeOf<typeof Message>;

export interface PeersState {
    removedPeers: Set<string>,
    addedPeers: Set<string>,
    peers: Set<string>,
};

export const PeersFromCommunicator = new EcsEvent<Set<string>>();
export const PeersEvent = new EcsEvent<PeersState>({ name: 'PeersEvent' });

export const MultiplayerData = new Component({
    name: 'MultiplayerData',
    type: t.type({
        owner: t.string,
    }),
});

export const Comms = new Component<{
    ownedUuids: Set<string>,
    admins: Set<string>,
    uuid: string | undefined,
    stateRequests: Map<string /* peer uuid */, Set<string /* Entity uuid */>>,
    lastEntities: Set<string>, // Entities
    messages: Message[],
}>({ name: 'Comms' });


function getEntityState(entity: Entity) {
    const componentStates: EntityState['state'] = new Map();
    for (const [component, componentData] of entity.components) {
        if (component.type) {
            // The component data is likely a draft, but might not be
            // if it was added this step.
            const currentData = isDraft(componentData)
                ? current(componentData)
                : componentData;

            componentStates.set(component.name,
                component.type.encode(currentData));
        }
    }
    return componentStates;
}

const PeersResource = new Resource<PeersState>({ name: 'PeersResource' });

const PeersSystem = new System({
    name: 'PeersSystem',
    events: [PeersFromCommunicator],
    args: [PeersFromCommunicator, PeersResource, Emit, SingletonComponent] as const,
    step: (peersFromCommunicator, peersResource, emit) => {
        peersResource.addedPeers = setDifference(peersFromCommunicator, peersResource.peers);
        peersResource.removedPeers = setDifference(peersResource.peers, peersFromCommunicator);
        peersResource.peers = peersFromCommunicator;
        emit(PeersEvent, peersResource);
    }
});

export const MultiplayerMessageEvent = new EcsEvent<unknown>({ name: 'MultiplayerMessageEvent' });
const MessageSystem = new System({
    name: 'MessageSystem',
    events: [MultiplayerMessageEvent],
    args: [MultiplayerMessageEvent, Comms] as const,
    step: (multiplayerMessage, comms) => {
        const maybeMessage = Message.decode(multiplayerMessage);
        if (isLeft(maybeMessage)) {
            console.warn('Failed to decode message');
            return;
        }
        comms.messages.push(maybeMessage.right);
    }
});



export function multiplayer(communicator: Communicator): Plugin {
    const multiplayerSystem = new System({
        name: 'Multiplayer',
        args: [new Query([UUID, GetEntity, MultiplayerData] as const),
            Entities, Components, Comms] as const,
        step: (query, entities, components, comms) => {
            comms.uuid = communicator.uuid;
            if (!comms.uuid) {
                // Can't do anything if we don't have a uuid.
                return;
            }

            function sendMessage(message: Message, destination?: string) {
                communicator.sendMessage(Message.encode(message), destination);
            }


            const entityMap = new Map(query.map(([uuid, entity, data]) =>
                [uuid, { entity, data }]));

            // Entities to request the full state of
            const fullStateRequests = new Set<string>();

            // Track entities added and removed
            const added = new Set<string>();
            const removed = new Set<string>();

            // Apply changes from messages
            for (const message of comms.messages) {
                const isAdmin = comms.admins.has(message.source);

                // Set admins
                if (isAdmin && message.admins) {
                    comms.admins = message.admins;
                }

                // Set requested states
                if (message.requestState) {
                    if (!comms.stateRequests.has(message.source)) {
                        comms.stateRequests.set(message.source, new Set());
                    }

                    for (const uuid of message.requestState ?? []) {
                        comms.stateRequests.get(message.source)?.add(uuid);
                    }
                }

                for (const uuid of message.remove ?? []) {
                    if (entityMap.has(uuid) &&
                        (entityMap.get(uuid)?.data.owner === message.source || isAdmin)) {
                        entities.delete(uuid);
                        fullStateRequests.delete(uuid);
                        added.delete(uuid);
                        removed.add(uuid);
                        entityMap.delete(uuid);
                    } else {
                        console.warn(`'${message.source}' tried to remove ${uuid}`);
                    }
                }

                // Add new entities
                for (const [uuid, entityState] of message.state ?? []) {
                    if (entityMap.has(uuid)
                        && entityMap.get(uuid)?.data.owner !== message.source
                        && !isAdmin) {
                        console.warn(`'${message.source}' tried to replace existing entity '${uuid}'`);
                        continue;
                    }

                    const entity = new EntityBuilder();
                    for (const [componentName, maybeState] of entityState.state) {
                        const component = components.get(componentName);
                        if (!component) {
                            console.warn(`New entity ${uuid} uses unknown component ${componentName}`);
                            continue;
                        }
                        if (!component.type) {
                            console.warn(`Component ${component.name} has no type and can not be created`);
                            continue;
                        }

                        // To generalize this to non fp-ts data, have components provide
                        // 'serialize' and 'deserialize' methods.
                        const state = component.type.decode(maybeState);
                        if (isLeft(state)) {
                            console.warn(state.left);
                            continue;
                        }
                        entity.addComponent(component, state.right);
                    }
                    const multiplayerData = {
                        owner: entityState.owner,
                    };
                    entity.addComponent(MultiplayerData, multiplayerData);
                    entities.set(uuid, entity.build());
                    const handle = entities.get(uuid)!;
                    added.add(uuid);
                    removed.delete(uuid);
                    // Add the newly added entity to the entityMap so we don't
                    // accidentally request its state in `apply deltas`.
                    entityMap.set(uuid, { entity: handle, data: multiplayerData });
                }

                // Set UUIDs
                if (message.ownedUuids) {
                    comms.ownedUuids = new Set(message.ownedUuids);
                }

                // Apply deltas
                for (const [uuid, entityDelta] of message.delta ?? []) {
                    if (!entityMap.has(uuid)) {
                        fullStateRequests.add(uuid);
                        continue;
                    }
                    const { entity, data } = entityMap.get(uuid)!;

                    if (message.source !== data.owner && !comms.admins.has(message.source)) {
                        console.warn(`'${message.source}' tried to modify entity '${uuid}'`);
                        continue;
                    }

                    for (const [componentName, componentDelta] of entityDelta) {
                        const component = components.get(componentName);
                        if (!component) {
                            console.warn(`No such component ${componentName}`);
                            continue;
                        }
                        const componentData = entity.components.get<unknown>(component);
                        if (!componentData) {
                            console.warn(`Entity ${uuid} does not have component ${component.name}`);
                            fullStateRequests.add(uuid);
                            continue;
                        }
                        if (!component.applyDelta) {
                            console.warn(`Component ${component.name} has no applyDelta function`);
                            continue;
                        }
                        if (!component.deltaType) {
                            console.warn(`Component ${component.name} has no deltaType for decoding`);
                            continue;
                        }

                        const maybeDelta = component.deltaType.decode(componentDelta);
                        if (isLeft(maybeDelta)) {
                            console.warn(`Component ${component.name} delta failed to decode`);
                            continue;
                        }
                        component.applyDelta(componentData, maybeDelta.right);
                    }
                }
            }
            comms.messages = [];

            if (fullStateRequests.size > 0) {
                // Request state from a trusted source
                const randomAdmin = [...comms.admins][Math.floor(Math.random() * comms.admins.size)];
                sendMessage({
                    source: comms.uuid,
                    requestState: [...fullStateRequests]
                }, randomAdmin);
            }


            const changes: Message = {
                source: comms.uuid,
                delta: new Map(),
                state: new Map(),
                remove: [],
                ownedUuids: [],
            };

            const entityUuids = new Set(query.map(([uuid]) => uuid));
            const addedEntities = setDifference(entityUuids,
                new Set([...comms.lastEntities, ...added]));
            const removedEntities = setDifference(comms.lastEntities,
                new Set([...entityUuids, ...removed]));
            comms.lastEntities = new Set([...entityUuids, ...added]);
            changes.remove = [...removedEntities];

            // Get states for new entities
            for (const uuid of addedEntities) {
                const val = entityMap.get(uuid);
                if (!val) {
                    throw new Error(`Expected to have entity ${uuid}`);
                }
                const { entity, data } = val;

                changes.state?.set(uuid, {
                    owner: data.owner,
                    state: getEntityState(entity)
                });
            }

            // Get deltas and create drafts 
            const newStates = new Set(changes.state?.keys());
            for (const [uuid, entity, multiplayerData] of query) {
                if (multiplayerData.owner !== comms.uuid) {
                    continue;
                }
                const entityDelta: EntityDelta = new Map(); // Serialized changes to an entity
                for (const [component, data] of entity.components) {
                    if (component.getDelta && component.deltaType) {
                        // The new draft to be used in place of the component's data.
                        // For tracking changes between runs of this system.
                        // TODO: Remove draftedness when losing ownership.
                        let newDraft: Draft<unknown>;
                        if (isDraft(data)) {
                            // If it's not a draft, there's no delta.
                            const originalData = original(data);
                            const currentData = finishDraft(data);
                            newDraft = createDraft(currentData as Objectish);
                            // Don't send a delta if we're sending a state.
                            if (!newStates.has(uuid)) {
                                const delta = component.getDelta(originalData, currentData);
                                if (delta) {
                                    entityDelta.set(component.name,
                                        component.deltaType.encode(delta));
                                }
                            }

                        } else {
                            newDraft = createDraft(data as Objectish);
                        }
                        entity.components.set(component, newDraft);
                    }
                }
                if (entityDelta.size > 0) {
                    changes.delta?.set(uuid, entityDelta);
                }
            }

            if (changes.delta?.size === 0) {
                delete changes.delta;
            }
            if (changes.state?.size === 0) {
                delete changes.state;
            }
            if (changes.remove?.length === 0) {
                delete changes.remove;
            }
            if (changes.ownedUuids?.length === 0) {
                delete changes.ownedUuids;
            }

            if (Object.keys(changes).length > 1) {
                // Only send if there's something to send.
                sendMessage(changes);
            }

            // Reply to requests for state
            for (const [peer, entityUuids] of comms.stateRequests) {
                const state: Message['state'] = new Map();

                for (const entityUuid of entityUuids) {
                    const val = entityMap.get(entityUuid);
                    if (val) {
                        const { entity, data } = val;
                        state.set(entityUuid, {
                            state: getEntityState(entity),
                            owner: data.owner
                        });
                    }
                }
                sendMessage({
                    source: comms.uuid,
                    state,
                }, peer);
            }
            comms.stateRequests = new Map();
        }
    });

    function build(world: World) {
        world.addSystem(multiplayerSystem);
        world.addSystem(MessageSystem);

        world.resources.set(PeersResource, {
            addedPeers: new Set<string>(),
            removedPeers: new Set<string>(),
            peers: new Set<string>(),
        });

        world.addSystem(PeersSystem);
        world.addComponent(MultiplayerData);
        world.singletonEntity.components.set(Comms, {
            ownedUuids: new Set<string>(),
            uuid: communicator.uuid,
            admins: new Set<string>(['server']),
            lastEntities: new Set<string>(),
            stateRequests: new Map(),
            messages: [],
        });

        communicator.messages.subscribe(message => {
            world.emit(MultiplayerMessageEvent, message);
        });

        communicator.peers.subscribe(peers => {
            world.emit(PeersFromCommunicator, peers);
        });
    }

    return {
        name: 'multiplayer',
        build
    }
}
