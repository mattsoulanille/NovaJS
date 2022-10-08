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

export const Change = t.union([
    t.type({
        action: t.union([t.literal('create'), t.literal('update')]),
        uuid: t.string,
        entity: EntityState,
    }),
    t.type({
        action: t.literal('remove'),
        uuid: t.string,
    }),
]);
export type Change = t.TypeOf<typeof Change>;
export const ChangesEvent = new EcsEvent<Change[]>('ChangesEvent');

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
        }
        applyChanges(worldCopy, changes, true /* structured clone */);
    }
});

type ComponentType<Data> = t.Type<Data, unknown, unknown>;
interface ComponentTypeMap<K extends Component<any>>
    extends Map<K, ComponentType<unknown>> {
    get<Data>(key: Component<Data>): ComponentType<Data> | undefined;
    set<Data>(key: Component<Data>, val: ComponentType<Data>): this;
}

export function create(entity: Entity, serializer: Serializer): Change {
    return {
        action: 'create',
        uuid: entity.uuid,
        entity: serializer.encode(entity),
    }
}

export function update(entity: Entity, serializer: Serializer): Change {
    return {
        action: 'update',
        uuid: entity.uuid,
        entity: serializer.encode(entity),
    }
}
export function remove(uuid: string): Change {
    return {
        action: 'remove',
        uuid,
    }
}

function* iterMaps<K, V>(a: Map<K, V>, b: Map<K, V>) {
    const visited = new Set<K>();
    for (const [k, va] of a) {
        visited.add(k);
        yield [k, va, b.get(k)] as const;
    }
    for (const [k, vb] of b) {
        if (visited.has(k)) {
            continue;
        }
        // a does not have k or it would be in `visited`
        yield [k, undefined, vb] as const;
    }
}

function getChanges(world: World, worldCopy: World,
                    include: IncludeChange): Change[] {
    const serializer = world.resources.get(SerializerResource);
    if (!serializer) {
        console.warn('Missing serializer resource for change detector');
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
        for (const [key, component, componentCopy] of
             iterMaps(entity.components, entityCopy.components)) {
            // TODO: Make serializer have a separate component thing. Right now, it just sends the whole entity.
            if (!equal(component, componentCopy)) {
                changes.push(update(entity, serializer));
                continue;
            }
        }
    }
    return changes;
}

function applyChanges(world: World, changes: Change[], clone = false) {
    const serializer = world.resources.get(SerializerResource);
    if (!serializer) {
        console.warn('Missing serializer resource for change detector');
        return;
    }

    for (const change of changes) {
        if (change.action === 'create' || change.action === 'update') {
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
        } else {
            world.entities.delete(change.uuid);
        }
    }
}

// TODO
// const ChangeDetectorIgnoreSystems = 

const ChangeDetectorAddSystem = new System({
    name: 'ChangeDetectorAddSystem',
    events: [AddSystemEvent],
    args: [AddSystemEvent, WorldCopy, SingletonComponent] as const,
    step(system, worldCopy) {
        try {
            worldCopy.addSystem(system);
        } catch (e) {
            console.warn(`Tried to add system ${system.name} for change`
                + ' detection. Should it be added to ChangeDetectorIgnore?\n',
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
        const serializer = world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error('Expected SerializerResource to exist');
        }

        world.resources.set(IncludeChangeResource, () => true);

        const worldCopy = new World(`{world.name} copy`);
        worldCopy.resources.set(SerializerResource, serializer);
        world.resources.set(WorldCopy, worldCopy);

        world.addSystem(DetectChanges);
        world.addSystem(ChangeDetectorRemoveSystem);
        world.addSystem(ChangeDetectorAddSystem);
    },
    remove(world) {
        world.removeSystem(DetectChanges);
    }
}
