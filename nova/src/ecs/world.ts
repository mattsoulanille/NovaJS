import produce, { Draft, enableMapSet, Immutable } from "immer";
import { Subscription } from "rxjs";
import { Component } from "./component";
import { ComponentsMap, Entity } from "./entity";
import { Query, QueryResults } from "./query";
import { Resource } from "./resource";
import { System } from "./system";
import { topologicalSort } from './utils';

export const Commands = Symbol();
export const UUID = Symbol();

export interface CommandsInterface {
    addEntity: (entity: Entity) => void;
    removeEntity: (entity: Entity | string) => void;
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
// What about resources?
// Idea: Run other nova systems in webworkers and pass the state to the main
// thread when you jump between systems.


interface WrappedSystem {
    system: System;
    entities: Set<string /* uuid */>;
}

interface WrappedEntity {
    entity: Entity;
    componentsSubscription?: Subscription;
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

    //private wrappedEntities = new Map<string, WrappedEntity>();

    private systems: Array<WrappedSystem> = []; // Not a map because order matters.
    private queries = new Map<Query, Set<string /* entity uuid */>>();

    readonly commands: CommandsInterface = {
        addEntity: this.addEntity.bind(this),
        removeEntity: this.removeEntity.bind(this),
    }

    private addEntity(entity: Entity) {
        this.state = produce(this.state, draft => {
            draft.entities.set(entity.uuid, {
                components: entity.components,
                multiplayer: entity.multiplayer,
                uuid: entity.uuid,
                name: entity.name
            });
        });

        for (const { system, entities } of this.systems) {
            if (system.supportsEntity(entity)) {
                entities.add(entity.uuid);
            }
        }
        for (const [query, entities] of this.queries) {
            if (query.supportsEntity(entity)) {
                entities.add(entity.uuid);
            }
        }
    }

    private removeEntity(entity: Entity | string): Entity {
        const entityUUID = entity instanceof Entity ? entity.uuid : entity;

        const entityData = this.state.entities.get(entityUUID);
        if (!entityData) {
            throw new Error(`No such entity ${entity}`);
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

                    const args = system.args.map(arg => {
                        if (arg instanceof Resource) {
                            if (!draft.resources.has(arg)) {
                                throw new Error(`Missing resource ${arg}`);
                            }
                            return draft.resources.get(arg);
                        } else if (arg instanceof Component) {
                            return entity.components.get(arg);
                        } else if (arg instanceof Query) {
                            return this.fulfillQuery(arg, draft);
                        } else if (arg === Commands) {
                            return this.commands;
                        } else if (arg === UUID) {
                            return entityUUID;
                        } else {
                            throw new Error(`Internal error: unrecognized arg ${arg}`);
                        }
                    });
                    // TODO: system.step accepts ...any[]. Fix this.
                    system.step(...args);
                }
            }
        });
    }

    private fulfillQuery<C extends readonly Component<any, any>[]>(
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

            return query.components.map(component =>
                entity.components.get(component))
        }) as unknown as QueryResults<Query<C>>;
    }
}
