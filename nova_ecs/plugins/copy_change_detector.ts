import equal from 'fast-deep-equal';
import { isLeft } from 'fp-ts/lib/Either';
import * as t from 'io-ts';
import { Emit, GetEntity, GetWorld } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { AddSystemEvent, EcsEvent, RemoveSystemEvent } from 'nova_ecs/events';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import { Plugin } from '../plugin';
import { DeltaMaker, DeltaPlugin, DeltaResource, EntityDelta } from './delta_plugin';
import { iterMaps } from './iter_maps';
import { MultiplayerData } from './multiplayer_plugin';
import { EntityState, Serializer, SerializerPlugin, SerializerResource } from './serializer_plugin';

// Detects changes by running a copy of the world and comparing it
// to the real world.

const WorldCopy = new Resource<World>('WorldCopy');

const EntityQuery = new Query([MultiplayerData, GetEntity] as const);

// const MessageSystem = new System({
//     name: 'MessageSystem',
//     events: [MultiplayerMessageEvent],
//     args: [MultiplayerMessageEvent, Comms] as const,
//     step: ({ message, source }, comms) => {
//         const maybeMessage = Message.decode(message);
//         if (isLeft(maybeMessage)) {
//             console.warn('Failed to decode message');
//             return;
//         }
//         comms.messages.push({ message: maybeMessage.right, source });
//     }
// });

const Create = t.type({
    action: t.literal('create'),
    uuid: t.string,
    entity: EntityState,
});
type Create = t.TypeOf<typeof Create>;

const Update = t.type({
    action: t.literal('update'),
    uuid: t.string,
    delta: EntityDelta,
});
type Update = t.TypeOf<typeof Update>;

const Remove = t.type({
    action: t.literal('remove'),
    uuid: t.string,
});
type Remove = t.TypeOf<typeof Remove>;

export const Change = t.union([Create, Update, Remove]);
export type Change = t.TypeOf<typeof Change>;
export const ChangesEvent = new EcsEvent<Change[]>('ChangesEvent');
export const ChangesResource = new Resource<Change[]>('ChangesResource');

type IncludeChange = (e: Entity) => boolean;
const IncludeChangeResource =
    new Resource<IncludeChange>('IncludeChange');

export const DetectChanges = new System({
    name: 'DetectChanges',
    args: [WorldCopy, GetWorld, IncludeChangeResource, Emit,
        SingletonComponent] as const,
    step(worldCopy, world, includeChange, emit) {
        worldCopy.step();
        const changes = getChanges(world, worldCopy, includeChange);
        if (changes.length) {
            emit(ChangesEvent, changes);
            world.resources.set(ChangesResource, changes);
        } else {
            world.resources.set(ChangesResource, []);
        }
        applyChanges(worldCopy, changes, true /* structured clone */);
    }
});

// type ComponentType<Data> = t.Type<Data, unknown, unknown>;
// interface ComponentTypeMap<K extends Component<any>>
//     extends Map<K, ComponentType<unknown>> {
//     get<Data>(key: Component<Data>): ComponentType<Data> | undefined;
//     set<Data>(key: Component<Data>, val: ComponentType<Data>): this;
// }

export function create(entity: Entity, serializer: Serializer): Change {
    return {
        action: 'create',
        uuid: entity.uuid,
        entity: serializer.encode(entity),
    }
}

export function update(before: Entity, after: Entity,
                       deltaMaker: DeltaMaker): Change | undefined {
    // if (before.uuid !== after.uuid) {
    //     throw new Error(`before uuid '${before.uuid}' must equal after uuid '${after.uuid}'`);
    // }

    const delta = deltaMaker.getDelta(before, after);

    if (!delta) {
        return;
    }

    return {
        action: 'update',
        uuid: after.uuid,
        delta
    }
}
export function remove(uuid: string): Change {
    return {
        action: 'remove',
        uuid,
    }
}

function getChanges(world: World, worldCopy: World,
                    include: IncludeChange): Change[] {
    const serializer = world.resources.get(SerializerResource);
    if (!serializer) {
        console.warn('Missing serializer resource for change detector');
        return [];
    }

    const deltaMaker = world.resources.get(DeltaResource);
    if (!deltaMaker) {
        console.warn('Missing deltaMaker resource for change detector');
        return [];
    }

    const changes: Change[] = [];

    for (const [key, entity, entityCopy] of iterMaps(world.entities,
                                                     worldCopy.entities)) {
        // Only run on entities with MultiplayerData that we own
        if (entity && !include(entity)) {
            continue;
        }

        if (!entity) {
            // Entity was removed this step.
            changes.push(remove(key));
            continue;
        }

        if (!entityCopy) {
            // Entity was added this step.
            changes.push(create(entity, serializer));
            continue;
        }

        // Compare components
        const maybeUpdate = update(entityCopy, entity, deltaMaker);
        if (maybeUpdate) {
            changes.push(maybeUpdate);
        }

        // for (const [key, component, componentCopy] of
        //      iterMaps(entity.components, entityCopy.components)) {
        //     // TODO: Make serializer have a separate component thing. Right now, it just sends the whole entity.
        //     if (!equal(component, componentCopy)) {
        //         changes.push(update(entity, serializer));
        //         continue;
        //     }
        // }
    }
    return changes;
}

/**
 * Apply changes to the world. Returns the set of entities that were updated but
 * not present in the world. The full state of these should be requested.
 */
export function applyChanges(world: World, changes: Change[], clone = false): Set<string> {
    const missingEntities = new Set<string>();

    const serializer = world.resources.get(SerializerResource);
    if (!serializer) {
        console.warn('Missing serializer resource for change detector');
        return missingEntities;
    }

    const deltaMaker = world.resources.get(DeltaResource);
    if (!deltaMaker) {
        console.warn('Missing deltaMaker resource for change detector');
        console.log([...world.resources.keys()].map(r => r.name));
        return missingEntities;
    }

    for (const change of changes) {
        if (change.action === 'create') {
            // TODO: Make update not send the whole entity?
            let encoded = change.entity;
            if (clone) {
                encoded = structuredClone(encoded); 
            }
            const entity = serializer.decode(encoded);
            if (isLeft(entity)) {
                console.warn(`Failed to decode entitiy ${change.uuid}`);
                continue;
            }
            world.entities.set(change.uuid, entity.right);
        } else if (change.action === 'update') {
            let entity = world.entities.get(change.uuid);
            if (!entity) {
                missingEntities.add(change.uuid);
                entity = new Entity();
                world.entities.set(change.uuid, entity);
            }

            let delta = change.delta;
            if (clone) {
                delta = structuredClone(delta);
            }
            deltaMaker.applyDelta(entity, delta);
        } else {
            world.entities.delete(change.uuid);
        }
    }
    return missingEntities;
}

export const RecordSystems = new Resource<(add: () => void) => void>(
    'RecordSystems');

// Adding new systems to the allowlist. Not just adding in general.
// When false, systems in the allowlist can still be added / removed.
const AddingSystems = new Resource<boolean>('AddingSystems');

// Systems that can be added / removed from the world copy.
const AllowedSystems =
    new Resource<Set<System>>('AllowedSystems');

const ChangeDetectorAddSystem = new System({
    name: 'ChangeDetectorAddSystem',
    events: [AddSystemEvent],
    args: [AddSystemEvent, WorldCopy, AllowedSystems, AddingSystems,
           SingletonComponent] as const,
    step(system, worldCopy, allow, addingSystems) {
        if (addingSystems) {
            allow.add(system);
        }

        if (!allow.has(system)) {
            return;
        }

        try {
            worldCopy.addSystem(system);
        } catch (e) {
            console.warn(`Tried to add system ${system.name} for change`
                + ' detection. Should it be removed from AllowedSystems?\n',
                         e);
        }
    }
});

const ChangeDetectorRemoveSystem = new System({
    name: 'ChangeDetectorRemoveSystem',
    events: [RemoveSystemEvent],
    args: [RemoveSystemEvent, WorldCopy, SingletonComponent] as const,
    step(system, worldCopy) {
        worldCopy.removeSystem(system);
    }
});    

export const CopyChangeDetector: Plugin = {
    name: 'CopyChangeDetector',
    build(world) {
        if (!world.resources.has(DeltaResource)) {
            world.addPlugin(DeltaPlugin);
        }

        if (!world.resources.has(SerializerResource)) {
            world.addPlugin(SerializerPlugin);
        }
        const serializer = world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error('Expected SerializerResource to exist');
        }

        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected DeltaResource to exist');
        }

        const worldCopy = new World(`{world.name} copy`);
        worldCopy.resources.set(SerializerResource, serializer);
        worldCopy.resources.set(DeltaResource, deltaMaker);
        world.resources.set(ChangesResource, []);
        world.resources.set(WorldCopy, worldCopy);
        world.resources.set(IncludeChangeResource, () => true);
        world.resources.set(AllowedSystems, new Set([]));
        world.resources.set(AddingSystems, false);
        world.resources.set(RecordSystems, (add: () => void) => {
            const orig = world.resources.get(AddingSystems);
            world.resources.set(AddingSystems, true);
            add();
            world.resources.set(AddingSystems, orig ?? false);
        });


        world.addSystem(DetectChanges);
        world.addSystem(ChangeDetectorRemoveSystem);
        world.addSystem(ChangeDetectorAddSystem);
    },
    remove(world) {
        // TODO
        world.removeSystem(DetectChanges);
    }
}
