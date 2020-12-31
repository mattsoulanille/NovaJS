import produce, { Draft, enableMapSet, Immutable } from "immer";
import { v4 } from "uuid";
import { ArgData, ArgTypes, Commands, GetEntity, GetEntityObject, OptionalClass, QueryArgTypes, QueryResults, UUID } from "./arg_types";
import { Component, ComponentData } from "./component";
import { ComponentsMap, Entity } from "./entity";
import { Plugin } from './plugin';
import { Query } from "./query";
import { Resource, ResourceData } from "./resource";
import { System } from "./system";
import { topologicalSort } from './utils';


// How do you serialize components and make sure the receiver
// knows which is which?

// How do you use immer and make patches when you step the state?

// How do you keep entities mostly like data while also allowing to
// add and remove components from them efficiently?

// How do you create new entities that need to asynchronously load data for their
// components from gameData?
// - Serialize ship to id + outfits. Deserialize takes long time and requires reconstruction
//   of properties from outfits. Just send the whole thing? How big is it?

// How does ecs draw stuff?
// - Can't store PIXI stuff as components since they're not immerable. Store references instead?

// Have each system that wants to be multiplayer use the Multiplayer component. Then,
// have a Multiplayer system that runs after other systems and queries for all systems
// that have multiplayer components. Then, that system sends and
// receives multiplayer messages. Solves Projectiles by not adding the Delta component
// to them (Wait, this doesn't actually work. If they don't have the Delta component,
// then the systems that add to Delta won't run). Add the ability to make
// components optional for a system to fix this? Seems good to me.
// It also solves the display systems since they simply don't add anything to the
// Delta component.
// To notify when an entity is added, it just sends that new Entity's delta.
// To notify when an entity is removed, we need some kind of teardown system?
// This loses the ease of use of immer patches, though.
// What about resources? Use an entity to update their deltas and put them onto the
// multiplayer component.

// Idea: Run other nova systems in webworkers and pass the state to the main
// thread when you jump between systems.

// Idea: Load async stuff by adding components to the entity as the data becomes
// available?

export interface CommandsInterface {
    addEntity: (entity: Entity) => EntityHandle;
    removeEntity: (entity: string | EntityHandle) => Entity | undefined;
    components: ReadonlyMap<string /* name */, Component<unknown, unknown>>;
}

interface WrappedSystem {
    system: System;
    entities: Set<string /* uuid */>;
}

interface State {
    entities: Map<string, EntityState>;
    resources: Map<Resource<unknown, unknown>, unknown>;
}

interface EntityState {
    components: ComponentsMap,
    uuid: string,
    name?: string,
    multiplayer: boolean,
}

export class EntityHandle {
    constructor(readonly uuid: string,
        private getComponents: () => ReadonlyComponentMap,
        private add: <Data>(component: Component<Data, any>, data: Data) => void,
        private remove: (component: Component<any, any>) => void) { }

    get components() {
        return this.getComponents();
    }

    addComponent<Data>(component: Component<Data, any>, data: Data) {
        this.add(component, data);
        return this;
    }

    removeComponent(component: Component<any, any>) {
        this.remove(component);
        return this;
    }
}

interface ReadonlyComponentMap extends ReadonlyMap<Component<unknown, unknown>, unknown> {
    get<Data>(component: Component<Data, any>): Data | undefined;
}

enableMapSet();

export class World {
    private state: Immutable<State> = {
        entities: new Map<string /* UUID */, EntityState>(),
        resources: new Map<Resource<unknown, unknown>, unknown /* resource data */>(),
    };

    // These maps exist in part to make sure there are no name collisions
    private nameComponentMap = new Map<string, Component<unknown, unknown>>();
    private nameSystemMap = new Map<string, System>();
    private nameResourceMap = new Map<string, Resource<unknown, unknown>>();

    private systems: Array<WrappedSystem> = []; // Not a map because order matters.
    private queries = new Map<Query, Set<string /* entity uuid */>>();
    private entityHandles = new Map<string /* uuid */, EntityHandle>();

    singletonEntity = this.addEntity(new Entity());

    constructor(private name?: string) { }

    addPlugin(plugin: Plugin) {
        // TODO: Namespace component and system names. Perhaps use ':' or '/' to
        // denote namespace vs name. Use a proxy like NovaData uses.
        plugin.build(this);
    }

    addEntity(entity: Entity): EntityHandle {
        const handle = this.addEntityToDraft(entity, (callback) => {
            // Can't directly pass the draft because addEntity binds
            // functions to edit the draft that can be called later.
            this.state = produce(this.state, callback);
        })
        this.entityHandles.set(handle.uuid, handle);
        return handle;
    }

    private addEntityToDraft(entity: Entity,
        callWithDraft: (callback: (draft: Draft<State>) => void) => void): EntityHandle {
        const uuid = entity.uuid ?? v4();
        for (const [component] of entity.components) {
            this.addComponent(component);
        }

        const entityState: EntityState = {
            components: entity.components,
            multiplayer: entity.multiplayer,
            uuid,
            name: entity.name
        };
        callWithDraft(draft => {
            draft.entities.set(uuid, entityState);
        });

        World.recomputeEntities({
            systems: this.systems, queries: this.queries, entities: [entityState]
        });

        return this.makeEntityHandle(uuid, callWithDraft);
    }

    private makeEntityHandle(uuid: string,
        callWithDraft: (callback: (draft: Draft<State>) => void) => void) {
        return new EntityHandle(uuid,
            () => {
                let components: ReadonlyComponentMap | undefined;
                callWithDraft(draft => {
                    const entity = draft.entities.get(uuid);
                    if (!entity) {
                        throw new Error(`entity '${uuid}' not in system`);
                    }
                    components = entity.components as ReadonlyComponentMap;
                })
                if (!components) {
                    throw new Error('Failed to get components');
                }
                return components;
            },
            (component, data) => {
                callWithDraft(draft => {
                    if (!draft.entities.has(uuid)) {
                        throw new Error(`entity '${uuid}' not in system`);
                    }
                    this.addComponent(component);

                    const entity = draft.entities.get(uuid)!;

                    entity.components.set(component as Component<unknown, unknown>, data);
                    World.recomputeEntities({
                        systems: this.systems,
                        queries: this.queries,
                        entities: [entity]
                    });
                });
            },
            (component) => {
                callWithDraft(draft => {
                    const entity = draft.entities.get(uuid);
                    if (!entity) {
                        throw new Error(`entity '${uuid}' not in system`);
                    }
                    entity.components.delete(component);
                    World.recomputeEntities({
                        systems: this.systems,
                        queries: this.queries,
                        entities: [entity]
                    });
                });
            }
        );
    }

    static recomputeEntities({ systems, queries, entities, removedEntities }: {
        systems: Iterable<WrappedSystem>,
        queries: Iterable<[Query, Set<string>]>,
        entities?: Iterable<Immutable<EntityState>>,
        removedEntities?: Iterable<Immutable<EntityState>>,
    }) {
        for (const entity of entities ?? []) {
            for (const { system, entities } of systems) {
                if (system.supportsEntity(entity)) {
                    entities.add(entity.uuid);
                } else {
                    entities.delete(entity.uuid);
                }
            }
            for (const [query, entities] of queries) {
                if (query.supportsEntity(entity)) {
                    entities.add(entity.uuid);
                } else {
                    entities.delete(entity.uuid);
                }
            }
        }

        for (const entity of removedEntities ?? []) {
            for (const { entities } of systems) {
                entities.delete(entity.uuid);
            }
            for (const [, entities] of queries) {
                entities.delete(entity.uuid);
            }
        }
    }

    removeEntity(entityOrUuid: string | EntityHandle): Entity | undefined {
        return this.removeEntityFromDraft(entityOrUuid, (callback) => {
            this.state = produce(this.state, callback);
        });
    }

    private removeEntityFromDraft(entityOrUuid: string | EntityHandle,
        callWithDraft: (callback: (draft: Draft<State>) => void) => void): Entity | undefined {
        const entityHandle = entityOrUuid instanceof EntityHandle
            ? entityOrUuid
            : this.entityHandles.get(entityOrUuid);

        const uuid = entityOrUuid instanceof EntityHandle
            ? entityOrUuid.uuid
            : entityOrUuid;

        // Delete the entity handle and remove its methods
        if (entityHandle && entityHandle === this.singletonEntity) {
            if (entityHandle === this.singletonEntity) {
                throw new Error('Cannot remove singleton entity');
            }
            const erf = () => { throw new Error(`entity '${entityHandle.uuid}' not in system`); }
            entityHandle.addComponent = erf;
            entityHandle.removeComponent = erf;
            this.entityHandles.delete(uuid);
        }

        const entityState = this.state.entities.get(uuid);
        if (!entityState) {
            return;
        }

        World.recomputeEntities({
            systems: this.systems, queries: this.queries, removedEntities: [entityState]
        });

        callWithDraft(draft => {
            draft.entities.delete(uuid);
        });

        const removedEntity = new Entity(entityState);
        for (const [component, data] of entityState.components) {
            removedEntity.addComponent(component, data);
        }
        return removedEntity;
    }

    addResource<Data, Delta>(resource: Resource<Data, Delta>, value: Data) {
        this.addResourceToDraft(resource, value, (callback) => {
            this.state = produce(this.state, callback);
        });
    }

    private addResourceToDraft<Data, Delta>(resource: Resource<Data, Delta>, value: Data,
        callWithDraft: (callback: (draft: Draft<State>) => void) => void) {
        if (this.nameResourceMap.has(resource.name)
            && this.nameResourceMap.get(resource.name) !== resource) {
            throw new Error(`A resource with name ${resource.name} already exists`);
        }
        this.nameResourceMap.set(resource.name, resource as Resource<unknown, unknown>);

        // TODO: Fix these types. Maybe pass resources in the World constructor?
        callWithDraft(draft => {
            draft.resources.set(resource as Resource<unknown, unknown>, value);
        });
    }

    addSystem(system: System): this {
        for (const resource of system.resources) {
            if (!this.state.resources.has(resource)) {
                throw new Error(
                    `World is missing ${resource} needed for ${system}`);
            }
        }

        if (this.nameSystemMap.has(system.name)
            && this.nameSystemMap.get(system.name) !== system) {
            throw new Error(`A system with name ${system.name} already exists`)
        }

        const wrappedSystem: WrappedSystem = { system, entities: new Set() };
        const queries: [Query, Set<string>][] = [...system.queries]
            .filter(query => !this.queries.has(query))
            .map(query => [query, new Set()]);

        World.recomputeEntities({
            systems: [wrappedSystem], queries, entities: this.state.entities.values()
        });

        // ---- Topologically insert the new system ----
        // Construct a graph with no edges. 
        const graph = new Map<WrappedSystem, Set<WrappedSystem>>(
            this.systems.map(val => [val, new Set()]));
        graph.set(wrappedSystem, new Set());

        // Add all edges to the graph. Store directed edges from node A to B on node B.
        const wrappedSystemMap = new Map<System | string, WrappedSystem>(
            [...[...graph.keys()].map(key => [key.system, key] as const),
            ...[...graph.keys()].map(key => [key.system.name, key] as const)]);

        for (const [wrappedSystem, incomingEdges] of graph) {
            // Systems that this system runs before have incoming edges from this
            // system in the graph.
            for (const beforeSystem of wrappedSystem.system.before) {
                const beforeVal = wrappedSystemMap.get(beforeSystem);
                if (beforeVal) {
                    const incomingBeforeEdges = graph.get(beforeVal);
                    incomingBeforeEdges?.add(wrappedSystem)
                }
            }

            // This system has incoming edges from the systems that it runs after.
            for (const afterSystem of wrappedSystem.system.after) {
                const afterVal = wrappedSystemMap.get(afterSystem);
                if (afterVal) {
                    incomingEdges.add(afterVal);
                }
            }
        }

        // Topologically sort the graph
        this.systems = topologicalSort(graph);

        for (const [query, entities] of queries) {
            this.queries.set(query, entities);
        }

        this.nameSystemMap.set(system.name, system);
        for (const component of system.components) {
            this.addComponent(component);
        }
        return this;
    }

    private addComponent<Data, Delta>(component: Component<Data, Delta>) {
        // Adds a component to the map of known components. Does not add to an entity.
        if (this.nameComponentMap.has(component.name)
            && this.nameComponentMap.get(component.name) !== component) {
            throw new Error(`A component with name ${component.name} already exists`);
        }

        this.nameComponentMap.set(component.name,
            component as Component<unknown, unknown>);
    }

    step() {
        this.state = produce(this.state, draft => {
            for (const { system, entities } of this.systems) {
                for (const entityUUID of entities) {
                    if (!draft.entities.has(entityUUID)) {
                        throw new Error(`Internal error: Missing entity ${entityUUID}`);
                    }
                    const entity = draft.entities.get(entityUUID)!;

                    // TODO: The types here don't quite work out since
                    // getArg returns ArgData<T> | undefined.
                    const args = system.args.map(arg =>
                        this.getArg(arg, draft, entity));

                    // TODO: system.step accepts ...any[]. Fix this.
                    system.step(...args);
                }
            }
        });
    }

    private getArg<T extends ArgTypes>(arg: T, draft: Draft<State>,
        entity: Draft<EntityState>): ArgData<T> | undefined {
        const commands = this.makeCommands(draft);
        if (arg instanceof Resource) {
            if (!draft.resources.has(arg)) {
                throw new Error(`Missing resource ${arg}`);
            }
            return draft.resources.get(arg) as ResourceData<T> | undefined;
        } else if (arg instanceof Component) {
            return entity.components.get(arg) as ComponentData<T> | undefined;
        } else if (arg instanceof Query) {
            return this.fulfillQuery(arg, draft) as QueryResults<T>;
        } else if (arg === Commands) {
            // TODO: Don't cast to ArgData<T>?
            return commands as ArgData<T>;
        } else if (arg === UUID) {
            // TODO: Don't cast to ArgData<T>?
            return entity.uuid as ArgData<T>;
        } else if (arg instanceof OptionalClass) {
            return this.getArg(arg.value, draft, entity);
        } else if (arg === GetEntity) {
            // TODO: Don't cast to ArgData<T>?
            return this.makeEntityHandle(entity.uuid, (callback) => {
                callback(draft);
            }) as ArgData<T>;
        } else {
            throw new Error(`Internal error: unrecognized arg ${arg}`);
        }
    }

    private makeCommands(draft: Draft<State>): CommandsInterface {
        return {
            addEntity: (entity) => {
                return this.addEntityToDraft(entity, (callback) => {
                    callback(draft);
                });
            },
            removeEntity: (entityOrUuid) => {
                return this.removeEntityFromDraft(entityOrUuid, (callback) => {
                    callback(draft);
                });
            },
            components: this.nameComponentMap
        }
    }

    private fulfillQuery<C extends readonly QueryArgTypes[]>(
        query: Query<C>, draft: Draft<State>): QueryResults<Query<C>> {

        const entityUUIDs = this.queries.get(query);
        if (!entityUUIDs) {
            throw new Error(`Internal Error: ${query} was not registered in the world`);
        }

        return [...entityUUIDs].map(entityUUID => {
            if (!draft.entities.has(entityUUID)) {
                throw new Error(`Missing entity ${entityUUID}`);
            }
            const entity = draft.entities.get(entityUUID)!;

            return query.args.map(arg =>
                this.getArg(arg, draft, entity));

        }) as unknown as QueryResults<Query<C>>;
    }

    toString() {
        return `World(${this.name ?? 'unnamed'})`;
    }
}
