import { isLeft } from 'fp-ts/lib/Either';
import { current, isDraft, original } from 'immer';
import * as t from 'io-ts';
import { Components, Entities, GetEntity, UUID } from '../arg_types';
import { Component } from '../component';
import { set } from '../datatypes/set';
import { Entity, EntityBuilder } from '../entity';
import { Plugin } from '../plugin';
import { Query } from '../query';
import { System } from '../system';
import { setDifference } from '../utils';
import { World } from '../world';


export interface Communicator {
    uuid: string | undefined;
    sendMessage(message: Message, destination?: string): void;
    getMessages(): Message[];
}

const EntityState = t.type({
    state: t.record(t.string /* Component Name */, t.unknown /* State */),
    owner: t.string,
})
type EntityState = t.TypeOf<typeof EntityState>;
const EntityDelta = t.record(t.string /* Component Name */, t.unknown /* Delta */);
type EntityDelta = t.TypeOf<typeof EntityDelta>;

export const Message = t.intersection([t.type({
    source: t.string, // UUID of the client or server the message came from.
}), t.partial({
    delta: t.record(t.string /* Entity UUID */, EntityDelta),
    state: t.record(t.string /* Entity UUID */, EntityState),
    requestState: t.array(t.string),
    remove: t.array(t.string),
    ownedUuids: t.array(t.string),
    admins: set(t.string),
    peers: set(t.string),
    playerShip: t.string,
})]);

export type Message = t.TypeOf<typeof Message>;

export const MultiplayerData = new Component({
    name: 'MultiplayerData',
    type: t.type({
        owner: t.string,
    }),
});

export const Comms = new Component<{
    ownedUuids: Set<string>,
    peers: Set<string>,
    admins: Set<string>,
    uuid: string | undefined,
    stateRequests: Map<string /* peer uuid */, Set<string /* Entity uuid */>>,
    added: Set<string>, // Entities added this step by ApplyChanges
    removed: Set<string>, // Entities removed this step by ApplyChanges
    lastEntities: Set<string>, // Entities
}>({ name: 'Comms' });

function getEntityState(entity: Entity) {
    const componentStates: EntityState['state'] = {};
    for (const [component, componentData] of entity.components) {
        if (component.type) {
            // The component data is likely a draft, but might not be
            // if it was added this step.
            const currentData = isDraft(componentData)
                ? current(componentData)
                : componentData;

            componentStates[component.name] =
                component.type.encode(currentData);
        }
    }
    return componentStates;
}

export function multiplayer(communicator: Communicator): Plugin {
    const applyChangesSystem = new System({
        name: 'ApplyChanges',
        args: [new Query([UUID, GetEntity, MultiplayerData] as const),
            Entities, Components, Comms] as const,
        step: (query, entities, components, comms) => {
            comms.uuid = communicator.uuid;
            if (!comms.uuid) {
                // Can't do anything if we don't have a uuid.
                return;
            }

            const messages = communicator.getMessages();
            const entityMap = new Map(query.map(([uuid, entity, data]) =>
                [uuid, { entity, data }]));

            // Entities to request the full state of
            const fullStateRequests = new Set<string>();

            for (const message of messages) {
                const isAdmin = comms.admins.has(message.source);

                // Set admins
                if (isAdmin && message.admins) {
                    comms.admins = message.admins;
                }

                // Set peers
                if (isAdmin && message.peers) {
                    comms.peers = message.peers;
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

                // Remove entities
                // TODO: Let them know they're being removed?
                // Solution: Implement events and emit a 'remove' event on the
                // entity (which runs each system that listens for 'remove and
                // that the entity satisfies).
                for (const uuid of message.remove ?? []) {
                    if (entityMap.has(uuid) &&
                        (entityMap.get(uuid)?.data.owner === message.source || isAdmin)) {
                        entities.delete(uuid);
                        fullStateRequests.delete(uuid);
                        comms.added.delete(uuid);
                        comms.removed.add(uuid);
                        entityMap.delete(uuid);
                    } else {
                        console.warn(`'${message.source}' tried to remove ${uuid}`);
                    }
                }

                // Add new entities
                for (const [uuid, entityState] of Object.entries(message.state ?? {})) {
                    if (entityMap.has(uuid)
                        && entityMap.get(uuid)?.data.owner !== message.source
                        && !isAdmin) {
                        console.warn(`'${message.source}' tried to replace existing entity ${uuid}`);
                        continue;
                    }

                    const entity = new EntityBuilder();
                    for (const [componentName, maybeState] of Object.entries(entityState.state)) {
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
                    comms.added.add(uuid);
                    comms.removed.delete(uuid);
                    // Add the newly added entity to the entityMap so we don't
                    // accidentally request its state in `apply deltas`.
                    entityMap.set(uuid, { entity: handle, data: multiplayerData });
                }

                // Set UUIDs
                if (message.ownedUuids) {
                    comms.ownedUuids = new Set(message.ownedUuids);
                }

                // Set player ship
                if (message.playerShip) {
                    // TODO
                }

                // Apply deltas
                for (const [uuid, entityDelta] of Object.entries(message.delta ?? {})) {
                    if (!entityMap.has(uuid)) {
                        fullStateRequests.add(uuid);
                        continue;
                    }
                    const { entity, data } = entityMap.get(uuid)!;

                    if (message.source !== data.owner && !comms.admins.has(message.source)) {
                        console.warn(`'${message.source}' tried to modify entity ${uuid}`);
                        continue;
                    }

                    for (const [componentName, componentDelta] of Object.entries(entityDelta)) {
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

            if (fullStateRequests.size > 0) {
                // Request state from a trusted source
                const randomAdmin = [...comms.admins][Math.floor(Math.random() * comms.admins.size)];
                communicator.sendMessage({
                    source: comms.uuid,
                    requestState: [...fullStateRequests]
                }, randomAdmin);
            }
        }
    });

    const sendChangesSystem = new System({
        name: 'SendChanges',
        args: [new Query([UUID, GetEntity, MultiplayerData] as const),
            Comms] as const,
        step: (query, comms) => {
            if (!comms.uuid) {
                // Can't send changes if we don't have a uuid
                return;
            }

            const changes: Message = {
                source: comms.uuid,
                delta: {},
                state: {},
                remove: [],
                ownedUuids: [],
            };

            const entities = new Set(query.map(([uuid]) => uuid));
            const addedEntities = setDifference(entities,
                new Set([...comms.lastEntities, ...comms.added]));
            const removedEntities = setDifference(comms.lastEntities,
                new Set([...entities, ...comms.removed]));
            comms.added = new Set();
            comms.removed = new Set();
            comms.lastEntities = entities;
            changes.remove = [...removedEntities];

            // Get states for new entities
            const entityMap = new Map(query.map(([uuid, entity, data]) =>
                [uuid, { entity, data }]));

            for (const uuid of addedEntities) {
                const val = entityMap.get(uuid);
                if (!val) {
                    throw new Error(`Expected to have entity ${uuid}`);
                }
                const { entity, data } = val;

                changes.state![uuid] = {
                    owner: data.owner,
                    state: getEntityState(entity)
                }
            }

            // Get deltas
            const newStates = new Set(Object.keys(changes.state ?? {}));
            for (const [uuid, entity, multiplayer] of query) {
                if (multiplayer.owner !== comms.uuid || newStates.has(uuid)) {
                    continue;
                }
                const entityDelta: EntityDelta = {};
                for (const [component, data] of entity.components.entries()) {
                    if (component.getDelta && component.deltaType && isDraft(data)) {
                        // If it's not a draft, there's no delta.
                        const delta = component.getDelta(original(data), data);
                        if (delta) {
                            entityDelta[component.name] = component.deltaType.encode(delta);
                        }
                    }
                }
                if (Object.keys(entityDelta).length > 0) {
                    changes.delta![uuid] = entityDelta;
                }
            }
            if (Object.keys(changes.delta ?? {}).length === 0) {
                delete changes.delta;
            }
            if (Object.keys(changes.state ?? {}).length === 0) {
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
                communicator.sendMessage(changes);
            }

            // Reply to requests for state
            for (const [peer, entityUuids] of comms.stateRequests) {
                const state: Message['state'] = {};

                for (const entityUuid of entityUuids) {
                    const val = entityMap.get(entityUuid);
                    if (val) {
                        const { entity, data } = val;
                        state[entityUuid] = {
                            state: getEntityState(entity),
                            owner: data.owner
                        }
                    }
                }

                communicator.sendMessage({
                    source: comms.uuid,
                    state,
                }, peer);
            }
            comms.stateRequests = new Map();
        },
        after: new Set([applyChangesSystem]),
    });


    function build(world: World) {
        world.addSystem(applyChangesSystem);
        world.addSystem(sendChangesSystem);
        world.addComponent(MultiplayerData);
        world.singletonEntity.components.set(Comms, {
            ownedUuids: new Set<string>(),
            uuid: communicator.uuid,
            peers: new Set<string>(),
            admins: new Set<string>(['server']),
            lastEntities: new Set<string>(),
            stateRequests: new Map(),
            added: new Set<string>(),
            removed: new Set<string>(),
        });
    }

    return {
        name: 'multiplayer',
        build
    }
}
