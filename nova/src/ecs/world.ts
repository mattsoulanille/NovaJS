import produce, { Draft, enableMapSet, Immutable } from "immer";
import { Component, ComponentData } from "./component";
import { ComponentsMap, Entity } from "./entity";
import { Query } from "./query";
import { Resource, ResourceData } from "./resource";
import { System } from "./system";
import { topologicalSort } from './utils';
import { v4 } from "uuid";
import { Plugin } from './plugin';
import { ArgData, ArgTypes, Commands, QueryArgTypes, QueryResults, UUID } from "./arg_types";


export interface CommandsInterface {
    addEntity: (entity: Entity) => string;
    removeEntity: (entity: string) => Entity | undefined;
}

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

// Have a Multiplayer system that runs after other systems and uses the Delta component,
// which other systems can add their deltas to. Then, that system sends and
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

enableMapSet();

export class World {
    private state: Immutable<State> = {
        entities: new Map<string /* UUID */, EntityState>(),
        resources: new Map<Resource<unknown, unknown>, unknown /* resource data */>(),
    };

    private systems: Array<WrappedSystem> = []; // Not a map because order matters.

    private queries = new Map<Query, Set<string /* entity uuid */>>();

    readonly commands: CommandsInterface = {
        addEntity: this.addEntity.bind(this),
        removeEntity: this.removeEntity.bind(this),
    }

    constructor(private name?: string) { }

    addPlugin(plugin: Plugin) {
        plugin.build(this);
    }

    private addEntity(entity: Entity) {
        const uuid = entity.uuid ?? v4();
        this.state = produce(this.state, draft => {
            draft.entities.set(uuid, {
                components: entity.components,
                multiplayer: entity.multiplayer,
                uuid,
                name: entity.name
            });
        });

        for (const { system, entities } of this.systems) {
            if (system.supportsEntity(entity)) {
                entities.add(uuid);
            }
        }
        for (const [query, entities] of this.queries) {
            if (query.supportsEntity(entity)) {
                entities.add(uuid);
            }
        }
        return uuid;
    }

    private removeEntity(entityUUID: string): Entity | undefined {
        const entityData = this.state.entities.get(entityUUID);
        if (!entityData) {
            return;
        }

        for (const { entities } of this.systems) {
            entities.delete(entityUUID);
        }
        for (const [, entities] of this.queries) {
            entities.delete(entityUUID);
        }

        this.state = produce(this.state, draft => {
            draft.entities.delete(entityUUID);
        });

        const removedEntity = new Entity(entityData);
        for (const [component, data] of entityData.components) {
            removedEntity.addComponent(component, data);
        }
        return removedEntity;
        // TODO: Notify peers or server?
    }

    addResource<Data, Delta>(resource: Resource<Data, Delta>, value: Data) {
        // TODO: Fix these types. Maybe pass resources in the World constructor?
        this.state = produce(this.state, draft => {
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

        const entities = new Set([...this.state.entities.values()]
            .filter(entity => system.supportsEntity(entity))
            .map(entity => entity.uuid));

        // Add queries from the system
        for (const query of system.queries) {
            if (this.queries.has(query)) {
                continue;
            }

            const queryEntities = new Set([...this.state.entities.values()]
                .filter(query.supportsEntity)
                .map(entity => entity.uuid));

            this.queries.set(query, queryEntities);
        }

        // ---- Topologically insert the new system ----

        // Construct a graph with no edges. 
        const graph = new Map<WrappedSystem, Set<WrappedSystem>>(
            this.systems.map(val => [val, new Set()]));
        graph.set({ system, entities }, new Set());

        // Add all edges to the graph. Store directed edges from node A to B on node B.
        const wrappedSystemMap = new Map<System, WrappedSystem>(
            [...graph.keys()].map(key => [key.system, key]));

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
        return this;
    }

    step() {
        this.state = produce(this.state, draft => {
            for (const { system, entities } of this.systems) {
                for (const entityUUID of entities) {
                    if (!draft.entities.has(entityUUID)) {
                        throw new Error(`Internal error: Missing entity ${entityUUID}`);
                    }
                    const entity = draft.entities.get(entityUUID)!;

                    const args = system.args.map(arg =>
                        this.getArg(arg, draft, entity));

                    // TODO: system.step accepts ...any[]. Fix this.
                    system.step(...args);
                }
            }
        });
    }

    private getArg<T extends ArgTypes>(arg: T, draft: Draft<State>,
        entity: Draft<EntityState>): ArgData<T> {
        if (arg instanceof Resource) {
            if (!draft.resources.has(arg)) {
                throw new Error(`Missing resource ${arg}`);
            }
            return draft.resources.get(arg) as ResourceData<T>;
        } else if (arg instanceof Component) {
            return entity.components.get(arg) as ComponentData<T>;
        } else if (arg instanceof Query) {
            return this.fulfillQuery(arg, draft) as QueryResults<T>;
        } else if (arg === Commands) {
            // TODO: Don't cast to ArgData<T>?
            return this.commands as ArgData<T>;
        } else if (arg === UUID) {
            // TODO: Don't cast to ArgData<T>?
            return entity.uuid as ArgData<T>;
        } else {
            throw new Error(`Internal error: unrecognized arg ${arg}`);
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
