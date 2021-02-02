import produce, { Draft, enableMapSet, enablePatches, Immutable } from "immer";
import { ArgData, ArgTypes, Components, Entities, GetEntity, OptionalClass, QueryArgsToData, QueryResults, UUID } from "./arg_types";
import { AsyncSystemPlugin } from "./async_system";
import { Component, ComponentData, UnknownComponent } from "./component";
import { Entity } from "./entity";
import { EntityMap, EntityMapHandle } from "./entity_map";
import { Plugin } from './plugin';
import { Query } from "./query";
import { Resource, ResourceData, UnknownResource } from "./resource";
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

enablePatches();

export interface State {
    entities: EntityMap;
    resources: Map<UnknownResource, unknown>;
}

export type CallWithDraft = <R>(callback: (draft: Draft<State>) => R) => R;

interface ReadonlyResourceMap extends ReadonlyMap<UnknownResource, unknown> {
    get<Data>(resource: Resource<Data, any, any, any>): Data | undefined;
}

enableMapSet();

export class World {
    private state: Immutable<State> = {
        entities: new Map(),
        resources: new Map(),
    };

    private mutableEntities: EntityMap = new Map();
    private mutableResources = new Map<UnknownResource,
        unknown /* resource data */>();

    readonly entities = new EntityMapHandle(
        this.mutableEntities,
        this.callWithNewDraft.bind(this),
        this.addComponent.bind(this));

    get resources() {
        return new Map([
            ...this.state.resources,
            ...this.mutableResources,
        ]) as ReadonlyResourceMap;
    }

    // These maps exist in part to make sure there are no name collisions
    private nameComponentMap = new Map<string, UnknownComponent>();
    private nameSystemMap = new Map<string, System>();
    private nameResourceMap = new Map<string, UnknownResource>();

    private systems: Array<System> = []; // Not a map because order matters.
    singletonEntity: Entity;

    constructor(private name?: string) {
        this.addPlugin(AsyncSystemPlugin);
        this.entities.set('singleton', {
            components: new Map(),
            multiplayer: false,
            name: 'singleton'
        });
        this.singletonEntity = this.entities.get('singleton')!;
    }

    addPlugin(plugin: Plugin) {
        // TODO: Namespace component and system names. Perhaps use ':' or '/' to
        // denote namespace vs name. Use a proxy like NovaData uses.
        plugin.build(this);
    }

    private callWithNewDraft<R>(callback: (draft: Draft<State>) => R) {
        // Can't directly pass the draft because addEntity binds
        // functions to edit the draft that can be called later.
        let result: R;
        let called = false;
        this.state = produce(this.state, draft => {
            result = callback(draft);
            called = true;
        });
        if (!called) {
            throw new Error('Expected to be called');
        }
        return result!;
    }

    // TODO: Resource map like entities
    addResource<Data>(resource: Resource<Data, any, any, any>, value: Data) {
        if (resource.mutable) {
            this.updateResourceMap(resource);
            this.mutableResources.set(resource as UnknownResource, value);
        } else {
            this.addResourceToDraft(resource, value,
                this.callWithNewDraft.bind(this));
        }
    }

    private updateResourceMap(resource: Resource<any, any, any, any>) {
        if (this.nameResourceMap.has(resource.name)
            && this.nameResourceMap.get(resource.name) !== resource) {
            throw new Error(`A resource with name ${resource.name} already exists`);
        }
        this.nameResourceMap.set(resource.name, resource as UnknownResource);
    }

    private addResourceToDraft<Data>(resource: Resource<Data, any, any, any>,
        value: Data, callWithDraft: CallWithDraft) {
        this.updateResourceMap(resource);
        // TODO: Fix these types. Maybe pass resources in the World constructor?
        callWithDraft(draft => {
            draft.resources.set(resource as UnknownResource, value);
        });
    }

    addSystem(system: System): this {
        for (const resource of system.resources) {
            if (!this.state.resources.has(resource)
                && !this.mutableResources.has(resource)) {
                throw new Error(
                    `World is missing ${resource} needed for ${system}`);
            }
        }

        if (this.nameSystemMap.has(system.name)
            && this.nameSystemMap.get(system.name) !== system) {
            throw new Error(`A system with name ${system.name} already exists`)
        }

        // ---- Topologically insert the new system ----
        // Construct a graph with no edges. 
        const graph = new Map<System, Set<System>>(
            this.systems.map(val => [val, new Set()]));
        graph.set(system, new Set());

        // Add all edges to the graph. Store directed edges from node A to B on node B.
        // Include the system itself and its name as mapping to the system
        const systemMap = new Map<System | string, System>(
            [...[...graph.keys()].map(key => [key, key] as const),
            ...[...graph.keys()].map(key => [key.name, key] as const)]);

        for (const [system, incomingEdges] of graph) {
            // Systems that this system runs before have incoming edges from this
            // system in the graph.
            for (const before of system.before) {
                const beforeSystem = systemMap.get(before);
                if (beforeSystem) {
                    const incomingBeforeEdges = graph.get(beforeSystem);
                    incomingBeforeEdges?.add(system)
                }
            }

            // This system has incoming edges from the systems that it runs after.
            for (const after of system.after) {
                const afterSystem = systemMap.get(after);
                if (afterSystem) {
                    incomingEdges.add(afterSystem);
                }
            }
        }

        // Topologically sort the graph
        this.systems = topologicalSort(graph);

        this.nameSystemMap.set(system.name, system);
        for (const component of system.components) {
            this.addComponent(component);
        }
        return this;
    }

    addComponent(component: Component<any, any, any, any>) {
        // Adds a component to the map of known components. Does not add to an entity.
        // Necessary for multiplayer to create entities with components that haven't
        // been used yet.
        if (this.nameComponentMap.has(component.name)
            && this.nameComponentMap.get(component.name) !== component) {
            throw new Error(`A component with name ${component.name} already exists`);
        }

        this.nameComponentMap.set(component.name, component);
    }

    step() {
        this.state = produce(this.state, draft => {
            for (const system of this.systems) {
                const argList = this.fulfillQuery(system.query, draft);
                for (const args of argList) {
                    system.step(...args);
                }
            }
        });
    }

    private getArg<T extends ArgTypes>(arg: T, draft: Draft<State>,
        entity: Draft<Entity>, uuid: string): ArgData<T> | undefined {
        if (arg instanceof Resource) {
            if (draft.resources.has(arg)) {
                return draft.resources.get(arg) as ResourceData<T> | undefined;
            } else if (this.mutableResources.has(arg)) {
                return this.mutableResources.get(arg) as ResourceData<T> | undefined;
            } else {
                throw new Error(`Missing resource ${arg}`);
            }
        } else if (arg instanceof Component) {
            return entity.components.get(arg) as ComponentData<T> | undefined;
        } else if (arg instanceof Query) {
            return this.fulfillQuery(arg, draft) as QueryResults<T>;
        } else if (arg === Entities) {
            // TODO: Don't cast to ArgData<T>?
            return draft.entities as ArgData<T>;
        } else if (arg === Components) {
            // TODO: Don't cast to ArgData<T>?
            return this.nameComponentMap as ArgData<T>;
        } else if (arg === UUID) {
            // TODO: Don't cast to ArgData<T>?
            return uuid as ArgData<T>;
        } else if (arg instanceof OptionalClass) {
            return this.getArg(arg.value, draft, entity, uuid);
        } else if (arg === GetEntity) {
            // TODO: Don't cast to ArgData<T>?
            return draft.entities.get(uuid) as ArgData<T>;
        } else {
            throw new Error(`Internal error: unrecognized arg ${arg}`);
        }
    }

    private fulfillQuery<C extends readonly ArgTypes[]>(
        query: Query<C>, draft: Draft<State>): QueryResults<Query<C>> {

        const entities = [...draft.entities].filter(
            ([, entity]) => query.supportsEntity(entity));

        return entities.map(([uuid, entity]) =>
            query.args.map(arg => this.getArg(arg, draft, entity, uuid)
            ) as unknown as QueryArgsToData<C>
        );
    }

    toString() {
        return `World(${this.name ?? 'unnamed'})`;
    }
}
