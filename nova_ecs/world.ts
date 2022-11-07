import { Either, isLeft, left, Right, right } from "fp-ts/Either";
import { ArgModifier, UnknownArgModifier } from "./arg_modifier";
import { ArgData, ArgTypes, Components, Emit, EmitFunction, EmitNow, Entities, GetArg, GetEntity, GetWorld, RunQuery, RunQueryFunction, UUID } from "./arg_types";
import { ProvideAsyncPlugin } from "./provide_async";
import { AsyncSystemPlugin } from "./async_system";
import { Component, UnknownComponent } from "./component";
import { Entity } from "./entity";
import { EntityMapWithEvents } from "./entity_map";
import { AddEvent, DeleteEvent, EcsEvent, StepEvent, UnknownEvent } from "./events";
import { SyncSubject } from "./event_map";
import { Plugin } from './plugin';
import { ProvidePlugin } from "./provide";
import { Query } from "./query";
import { QueryCache } from "./query_cache";
import { Resource, UnknownResource } from "./resource";
import { ResourceMapWrapped } from "./resource_map";
import { System } from "./system";
import { DefaultMap, isPromise, topologicalSort } from './utils';

// Idea: Run other nova systems in webworkers and pass the state to the main
// thread when you jump between systems.

// Idea: Load async stuff by adding components to the entity as the data becomes
// available?

export const SingletonComponent = new Component<undefined>('SingletonComponent');

interface EcsEventWithEntities<Data> {
    event: EcsEvent<Data, any>;
    data: Data;
    entities?: Array<string | Entity>;
}

interface WorldEventsMap extends ReadonlyMap<UnknownEvent, SyncSubject<unknown>> {
    get<Data>(event: EcsEvent<Data>): SyncSubject<Data>
    has<Data>(event: EcsEvent<Data>): true;
}

/**
 * The root container of an ECS that holds the entities and systems. Every time
 * it is stepped, it calls each system on its supported entities.
 */
export class World {
    private readonly state = {
        entities: new EntityMapWithEvents(),
        resources: new ResourceMapWrapped(this.addResource.bind(this),
            this.removeResource.bind(this)),
    };

    readonly entities = this.state.entities;
    readonly resources = this.state.resources;

    // These maps exist in part to make sure there are no name collisions
    private nameComponentMap = new Map<string, UnknownComponent>();
    private nameSystemMap = new Map<string, System>();
    private nameResourceMap = new Map<string, UnknownResource>();

    private systems: Array<System> = []; // Not a map because order matters.
    singletonEntity: Entity;

    private eventQueue: EcsEventWithEntities<unknown>[] = [];

    private queries = new QueryCache(this.entities, this.resources, this.getArg.bind(this));
    readonly events = new DefaultMap<UnknownEvent, SyncSubject<unknown>>(
        () => new SyncSubject()) as WorldEventsMap;
    private pluginPromises = new Map<Plugin, Promise<void>>();
    readonly plugins = new Set<Plugin>();

    constructor(readonly name?: string, readonly basePlugins =
        new Set([AsyncSystemPlugin, ProvidePlugin, ProvideAsyncPlugin])) {
        for (const plugin of basePlugins) {
            this.addPlugin(plugin);
        }
        this.resources.set(Entities, this.entities);
        this.resources.set(RunQuery, this.runQuery);
        this.resources.set(GetWorld, this);
        this.resources.set(Emit, this.emit.bind(this));
        this.resources.set(EmitNow, this.emitNow.bind(this));
        this.entities.set('singleton', new Entity()
            .addComponent(SingletonComponent, undefined)
            .setName('singleton'));

        // Get the handle for the singleton entity.
        this.singletonEntity = this.entities.get('singleton')!;

        this.state.entities.events.delete.subscribe(deleted => {
            // Emit delete when an entity is deleted.
            this.emit(DeleteEvent, deleted, [...deleted].map(([, b]) => b));
        });

        this.state.entities.events.set.subscribe(addEntity => {
            this.emit(AddEvent, addEntity, [addEntity[1]]);
        });
    }

    /**
     * Emit an event to systems that listen for it. This event resolves
     * immediately, interrupting the current event, and does not sit in the
     * event queue.
     */
    emitNow<Data>(event: EcsEvent<Data, any>, data: Data,
        entities?: (string | Entity)[]) {
        this.runEvent({
            event: event as UnknownEvent,
            data,
            entities,
        });
        this.events.get(event).next(data);
    }
    /**
     * Emit an event to systems that listen for it. This event enters the event
     * queue and is resolved after all prior events in the queue.
     */
    emit<Data>(event: EcsEvent<Data, any>, data: Data,
        entities?: (string | Entity)[]) {
        this.eventQueue.push({
            event: event as UnknownEvent,
            data,
            entities,
        });
        // TODO: Should this emit now, or once the event runs?
        this.events.get(event).next(data);
    }

    
    /**
     * Remove all plugins in reverse order as they were added to the `World` by
     * calling their corresponding `removePlugin` functions (if present). This
     * does not remove plugins passed to World as `basePlugins` when it was
     * constructed.
     */
    async removeAllPlugins() {
        const plugins = [...this.plugins].reverse().filter(p => !this.basePlugins.has(p));
        for (const plugin of plugins) {
            await this.removePlugin(plugin);
        }
    }

    /**
     * Add a plugin to the `World` if it is not already added by calling its
     * `build` function with `this` instance of the `World`.
     */
    async addPlugin(plugin: Plugin) {
        // TODO: Namespace component and system names? Perhaps use ':' or '/' to
        // denote namespace vs name. Use a proxy like NovaData uses.
        if (this.plugins.has(plugin)) {
            // TODO: Should this warning be re-enabled?
            // console.warn(`Not adding plugin ${plugin.name} since it is already added`);
            return;
        }

        this.plugins.add(plugin);
        const pluginPromise = plugin.build(this);
        if (isPromise(pluginPromise)) {
            this.pluginPromises.set(plugin, pluginPromise);
            await pluginPromise;
        }
    }

    /**
     * Remove a plugin from the world by calling its `remove` function. If a
     * plugin does not implement a `remove` function, this does nothing.
     */
    async removePlugin(plugin: Plugin): Promise<boolean> {
        // TODO: Track what systems and resources a plugin adds and remove them
        // automatically (if a plugin does not implement `removePlugin`) as long
        // as no other plugins use them?

        // Wait for the plugin to finish building before removing it since this
        // can not be interrupted.
        if (this.pluginPromises.has(plugin)) {
            await this.pluginPromises.get(plugin)!;
        }
        if (plugin.remove != null) {
            plugin.remove(this); 
            this.plugins.delete(plugin);
            this.pluginPromises.delete(plugin);
            return true;
        }
        return false;
    }

    /**
     * Add a resource to the set of known resources. If you want to set the
     * value of a new resource, you should use `this.resources.set` instead
     * (and you don't need to call this function).
     *
     * This function exists only so a resource type can be declared in the world
     * without assigning it a value (including `undefined`) in the resource map.
     */
    addResource(resource: Resource<any>): this {
        if (this.nameResourceMap.has(resource.name)
            && this.nameResourceMap.get(resource.name) !== resource) {
            throw new Error(`A resource with name ${resource.name} already exists`);
        }
        this.nameResourceMap.set(resource.name, resource as UnknownResource);
        return this;
    }

    /**
     * Remove a resource from the known resources map. This does not delete the
     * resource from `this.resources`. Use `this.resources.delete` instead.
     */
    private removeResource(resource: Resource<any>): boolean {
        // Removes the resource from the nameResourceMap if possible.
        // Called by ResourceMap when deleting a resource.
        if (this.nameResourceMap.get(resource.name) !== resource) {
            return false;
        }

        for (const system of this.systems) {
            if (system.query.resources.has(resource)) {
                throw new Error(`Cannot remove resource ${resource.name} `
                    + `because ${system.name} uses it`);
            }
        }

        return this.nameResourceMap.delete(resource.name);
    }

    /**
     * Add a `Component` type to the map of known components. This does not add
     * an instance of the component to an entity. Call `entity.components.set` 
     * instead (and you don't need to call this function).
     *
     * This function exists only so a component type can be declared in the
     * world before any entities with it are added.
     */
    addComponent(component: Component<any>) {
        // Adds a component to the map of known components. Does not add to an entity.
        // Necessary for multiplayer to create entities with components that haven't
        // been used yet.
        if (this.nameComponentMap.has(component.name)
            && this.nameComponentMap.get(component.name) !== component) {
            throw new Error(`A component with name ${component.name} already exists`);
        }

        this.nameComponentMap.set(component.name, component);
    }

    /**
     * Add a `System` to the `World` to be called on supported entities whenever a
     * supported event fires. Unless configured differently, a system will run
     * whenever the `step` event is fired when `this.step` is called.
     */
    addSystem(system: System): this {
        for (const resource of system.query.resources) {
            if (!this.state.resources.has(resource)) {
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
        for (const component of system.query.components) {
            this.addComponent(component);
        }
        return this;
    }

    /**
     * Remove a `System` from the `World`.
     */
    removeSystem(system: System): this {
        if (this.nameSystemMap.get(system.name) !== system) {
            return this;
        }

        this.nameSystemMap.delete(system.name);
        const index = this.systems.indexOf(system);
        if (index >= 0) {
            this.systems.splice(index, 1);
        }

        return this;
    }

    /**
     * Flush the event queue.
     */
    private flush() {
        // Not a for loop because more events may be added as prior
        // ones are resolved.
        while (this.eventQueue.length > 0) {
            // TODO: Maybe use an actual queue for better time order.
            const ecsEvent = this.eventQueue.shift()!;
            this.runEvent(ecsEvent);
        }
    }

    private runEvent(eventWithEntities: EcsEventWithEntities<unknown>) {
        const systems = this.systems.filter(s => s.events.has(eventWithEntities.event));

        // Default to all entities if none are specified. When defaulting to all,
        // this includes entities added in the same step.
        let entities: Entity[] | undefined;
        if (eventWithEntities.entities) {
            entities = eventWithEntities.entities.map(entry => {
                if (typeof entry === 'string') {
                    return this.state.entities.get(entry);
                } else {
                    return entry;
                }
            }).filter((entry): entry is Entity => Boolean(entry));
        }

        const event = [eventWithEntities.event, eventWithEntities.data] as const;
        for (const system of systems) {
            const argList = this.queries.get(system.query)
                .getResult({ entities, event });
            for (const args of argList) {
                system.step(...args);
            }
        }
    }

    /**
     * Step the world forward. Add the `step` event to the event queue and then
     * flush the queue by calling Systems on the entities they support.
     */
    step() {
        this.eventQueue.push({
            event: StepEvent as UnknownEvent,
            data: true,
        });

        this.flush();
    }

    /**
     * Get the value for an `ArgType` from a given entity and event. This
     * function is usually mapped over a `Query`'s arg list, but it can also be
     * called separately.
     * 
     * This can be accessed within a system via the `GetArg` arg type, but its
     * use is discouraged. Prefer using a `Query` in the systems arguments or,
     * if necessary, the `RunQuery` arg type.
     */
    private getArg<T extends ArgTypes = ArgTypes>(arg: T,
        entity: Entity,
        event?: readonly [EcsEvent<unknown>, unknown]):
        Either<undefined, ArgData<T>> {
        if (arg instanceof Resource) {
            if (this.state.resources.has(arg)) {
                return right(this.state.resources.get(arg) as ArgData<T>);
            } else {
                throw new Error(`Missing resource ${String(arg)}`);
            }
        } else if (arg instanceof Component) {
            if (entity.components.has(arg)) {
                return right(entity.components.get(arg) as ArgData<T>);
            }
            return left(undefined);
        } else if (arg instanceof Query) {
            // Queries always fulfill because if no entities match, they return [].
            const query = this.queries.get(arg);
            return right(query.getResult() as ArgData<T>);
        } else if (arg === Components) {
            return right(this.nameComponentMap as ArgData<T>);
        } else if (arg === UUID) {
            return right(entity.uuid as ArgData<T>);
        } else if (arg === GetEntity) {
            return right(entity as ArgData<T>);
        } else if (arg === GetArg) {
            // TODO: Why don't these types work?
            return right(<T extends ArgTypes = ArgTypes>(arg: T) =>
                this.getArg<T>(arg, entity, event)) as Right<ArgData<T>>;
        } else if (arg instanceof EcsEvent) {
            if (!event) {
                return left(undefined);
            }
            const [ecsEvent, data] = event;
            if (ecsEvent === arg) {
                return right(data as ArgData<T>);
            }
            return left(undefined);
        } else if (arg instanceof ArgModifier) {
            const modifier = arg as UnknownArgModifier;
            const query = this.queries.get(modifier.query);
            const modifierQueryResults =
                query.getResultForEntity(entity, event);
            if (isLeft(modifierQueryResults)) {
                return left(undefined);
            }
            return modifier.transform(...modifierQueryResults.right) as
                Either<undefined, ArgData<T>>;
        } else {
            throw new Error(`Internal error: unrecognized arg ${String(arg)}`);
        }
    }

    /**
     * Run a query on all entities or a given entity.
     * 
     * This can be accessed in a system via the `RunQuery` arg type, but often,
     * a query can be added to a system's args list instead of calling this
     * function in the system.
     */
     private runQuery: RunQueryFunction =
        <T extends readonly ArgTypes[] = ArgTypes[]>(query: Query<T>, uuid?: string | undefined) => {
            const queryCached = this.queries.get(query);
            if (uuid !== undefined) {
                const entity = this.entities.get(uuid);
                if (!entity) {
                    return [];
                }
                const result = queryCached.getResultForEntity(entity);
                if (isLeft(result)) {
                    return [];
                }
                return [result.right];
            }
            return queryCached.getResult();
        }

    toString() {
        return `World(${this.name ?? 'unnamed'})`;
    }
}
