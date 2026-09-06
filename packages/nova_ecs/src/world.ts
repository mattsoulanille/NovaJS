import { Either, isLeft, left, right } from "fp-ts/lib/Either.js";
import { ArgModifier, UnknownArgModifier } from "./arg_modifier.js";
import { ArgData, ArgTypes, Components, Emit, EmitFunction, EmitNow, Entities, GetArg, GetArgFunction, GetEntity, GetWorld, RunQuery, RunQueryFunction, UUID } from "./arg_types.js";
import { ProvideAsyncPlugin } from "./provide_async.js";
import { AsyncSystemPlugin } from "./async_system.js";
import { Component, UnknownComponent } from "./component.js";
import { Entity } from "./entity.js";
import { EntityMapWithEvents } from "./entity_map.js";
import { AddEvent, DeleteEvent, EcsEvent, EcsEventWithEntities, StepEvent, UnknownEvent, UnknownEventWithEntities } from "./events.js";
import { SyncSubject } from "./event_map.js";
import { Plugin } from './plugin.js';
import { ProvidePlugin } from "./provide.js";
import { Query } from "./query.js";
import { QueryCache } from "./query_cache.js";
import { Resource, UnknownResource } from "./resource.js";
import { ResourceMapWrapped } from "./resource_map.js";
import { Marker, Phase, Sortable, System, SystemSet } from "./system.js";
import { DefaultMap, isPromise, topologicalSortList } from './utils.js';

// Idea: Run other nova systems in webworkers and pass the state to the main
// thread when you jump between systems.

// Idea: Load async stuff by adding components to the entity as the data becomes
// available?

export const SingletonComponent = new Component<undefined>('SingletonComponent');

interface WorldEventsMap extends ReadonlyMap<UnknownEvent, SyncSubject<UnknownEventWithEntities>> {
    get<Data>(event: EcsEvent<Data>): SyncSubject<EcsEventWithEntities<Data>>
    has<Data>(event: EcsEvent<Data>): true;
}

function eraseEventWithEntities<Data>(
    eventWithEntities: EcsEventWithEntities<Data>,
): UnknownEventWithEntities {
    return eventWithEntities as unknown as UnknownEventWithEntities;
}

function filterSystems(sortables: Sortable[]): System[] {
    return sortables.filter((s): s is System => s instanceof System);
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

    /**
     * Every system and marker in registration (addSystem/addMarker)
     * order. `sortables` is always `topologicalSortList(registered)`:
     * a pure function of registration order and declared edges. (It
     * used to be the previous sorted output re-sorted with the new node
     * appended, which made an unconstrained pair's order depend on the
     * sort history — #43.) Registration order is deterministic today
     * because every simulation plugin registers synchronously in a
     * fixed order; `systemNames` lets peers check they agree.
     */
    private registered: Array<Sortable> = [];
    private sortables: Array<Sortable> = []; // This includes systems and markers
    private systems: Array<System> = []; // Not a map because order matters.
    /**
     * Systems that respond to each event, in `systems` order. Cleared
     * whenever `systems` changes; a system's event set is fixed at
     * construction, so this is a pure function of `systems`. Component
     * change events fire thousands of times per step and mostly match
     * no system at all, which made the per-event filter over every
     * system a measurable cost.
     */
    private systemsByEvent = new Map<UnknownEvent, System[]>();
    singletonEntity: Entity;

    private eventQueue: EcsEventWithEntities<unknown>[] = [];

    private queries = new QueryCache(this.entities, this.resources, this.getArg.bind(this));
    readonly events = new DefaultMap<UnknownEvent, SyncSubject<UnknownEventWithEntities>>(
        () => new SyncSubject()) as WorldEventsMap;
    private pluginPromises = new Map<Plugin, Promise<void>>();
    /**
     * Plugins whose build (including the builds of the plugins they add) has
     * started but not finished. Used to avoid waiting on a plugin that is
     * (possibly transitively) waiting on us, which would deadlock.
     */
    private buildingPlugins = new Set<Plugin>();
    /**
     * Stack of collectors for nested `addPlugin` calls.
     *
     * `Plugin.build` is synchronous (it may return a promise, but a plugin
     * that adds other plugins from a synchronous build can not await them),
     * so nested `addPlugin` calls are usually fire-and-forget. Each
     * `addPlugin` pushes a frame before calling `build` and does not resolve
     * until everything registered in that frame has settled. That makes a
     * failure at any depth reject the outermost awaited `addPlugin`, and
     * guarantees no nested plugin is still registering systems once it
     * resolves (which used to race a subsequent `world.step()`).
     */
    private pluginBuildFrames: Promise<void>[][] = [];
    readonly plugins = new Set<Plugin>();

    constructor(readonly name?: string, readonly basePlugins =
        new Set([AsyncSystemPlugin, ProvidePlugin, ProvideAsyncPlugin])) {
        for (const plugin of basePlugins) {
            // A constructor can not await these. Base plugins build
            // synchronously, so their systems and resources are in place when
            // this returns; a base plugin with an asynchronous build would
            // still race the caller (and report failures as unhandled
            // rejections).
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
    emitNow<Data>(event: EcsEvent<Data>, data: Data,
        entities?: (string | Entity)[]) {
        const eventWithEntities: EcsEventWithEntities<Data> = {
            event,
            data,
            entities,
        };
        this.runEvent(eraseEventWithEntities(eventWithEntities));
        this.events.get(event).next(eventWithEntities);
    }
    /**
     * Emit an event to systems that listen for it. This event enters the event
     * queue and is resolved after all prior events in the queue.
     */
    emit<Data>(event: EcsEvent<Data>, data: Data,
        entities?: (string | Entity)[]) {
        const eventWithEntities: EcsEventWithEntities<Data> = {
            event,
            data,
            entities,
        };
        this.eventQueue.push(eraseEventWithEntities(eventWithEntities));
        // Outside subscribers (`world.events.get(E).subscribe`) hear the
        // event as soon as it is emitted, before the systems queued for
        // it run.
        this.events.get(event).next(eventWithEntities);
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
     *
     * The returned promise does not resolve until the plugin and every plugin
     * it adds (at any depth) have finished building, and it rejects if any of
     * those builds fails. Plugins commonly add other plugins from a
     * synchronous `build`, which can not await them; those nested promises are
     * collected here instead of being dropped.
     */
    addPlugin(plugin: Plugin): Promise<void> {
        // Read the enclosing build's frame synchronously: it is only the
        // current one while the enclosing `build` is on the stack.
        const parentFrame =
            this.pluginBuildFrames[this.pluginBuildFrames.length - 1];
        const added = this.addPluginInternal(plugin, parentFrame);
        if (parentFrame) {
            // A nested call's failure is reported by the enclosing
            // `addPlugin` (through `parentFrame`), so mark this promise
            // handled. Without this, the usual fire-and-forget nested call
            // would *also* surface the failure as an unhandled rejection.
            // Callers that do await a nested call still see the rejection.
            added.catch(() => { });
        }
        return added;
    }

    private async addPluginInternal(plugin: Plugin,
        parentFrame?: Promise<void>[]): Promise<void> {
        // Component and system names are a single global namespace; see
        // the tracker issue on per-plugin namespacing (also noted at
        // component.ts).
        if (this.plugins.has(plugin)) {
            // Re-adding is routine (plugins add the plugins they depend
            // on), so it is silent rather than a warning.
            const existing = this.pluginPromises.get(plugin);
            // Only wait on a build that has already finished (to report its
            // failure). Waiting on one that is still building risks
            // deadlocking on a cyclic plugin graph, and is not needed for
            // completeness: whoever added it first is in this same build tree
            // and is already waited on.
            if (existing && !this.buildingPlugins.has(plugin)) {
                await existing;
            }
            return;
        }

        this.plugins.add(plugin);
        const pluginPromise = this.buildPlugin(plugin);
        this.pluginPromises.set(plugin, pluginPromise);
        // Hand the promise to the enclosing build, which can not await it
        // itself.
        parentFrame?.push(pluginPromise);
        await pluginPromise;
    }

    /**
     * Call a plugin's `build` and wait for it and for every plugin it adds.
     */
    private async buildPlugin(plugin: Plugin): Promise<void> {
        const frame: Promise<void>[] = [];
        this.buildingPlugins.add(plugin);
        try {
            // Both of these wait for everything they cover even when part of
            // it fails, so a failed load never leaves a plugin registering
            // systems in the background. The plugin's own failure is reported
            // in preference to a nested one since it's the likelier cause.
            const buildFailure = await this.runPluginBuild(plugin, frame);
            const nestedFailure = await this.drainPluginFrame(frame);
            if (buildFailure) {
                throw buildFailure.reason;
            }
            if (nestedFailure) {
                throw nestedFailure.reason;
            }
        } finally {
            this.buildingPlugins.delete(plugin);
        }
    }

    /**
     * Call `plugin.build` with `frame` as the collector for the plugins it
     * adds. Returns its failure instead of throwing it.
     */
    private async runPluginBuild(plugin: Plugin, frame: Promise<void>[]):
        Promise<{ reason: unknown } | undefined> {
        let built: void | Promise<void>;
        this.pluginBuildFrames.push(frame);
        try {
            built = plugin.build(this);
        } catch (reason) {
            return { reason };
        } finally {
            // `build` has returned control, so its frame is no longer the
            // enclosing one, even if it returned a promise.
            this.pluginBuildFrames.pop();
        }
        if (isPromise(built)) {
            try {
                await built;
            } catch (reason) {
                return { reason };
            }
        }
        return undefined;
    }

    /**
     * Wait for every plugin registered in `frame`, and for the plugins they
     * add in turn. Returns the first failure instead of throwing it.
     */
    private async drainPluginFrame(frame: Promise<void>[]):
        Promise<{ reason: unknown } | undefined> {
        let failure: { reason: unknown } | undefined;
        // Not a `for` loop: waiting on these can register more.
        while (frame.length > 0) {
            const results = await Promise.all(frame.splice(0).map(
                pluginPromise => pluginPromise.then(
                    () => undefined, (reason: unknown) => ({ reason }))));
            failure = failure ?? results.find(result => result);
        }
        return failure;
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
            // A build failure is reported to whoever added the plugin. Here it
            // only means there is nothing left to wait for.
            await this.pluginPromises.get(plugin)!.catch(() => { });
        }
        if (plugin.remove != null) {
            // Await async removes: dropping the promise hides teardown
            // errors as unhandled rejections and lets the caller race
            // ahead of a teardown still in flight.
            await plugin.remove(this);
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
                  `${this} is missing ${resource} needed for ${system}`);
            }
        }

        if (this.nameSystemMap.has(system.name)
            && this.nameSystemMap.get(system.name) !== system) {
            throw new Error(`A system with name ${system.name} already exists`)
        }

        this.register(system);
        this.nameSystemMap.set(system.name, system);

        for (const component of system.query.components) {
            this.addComponent(component);
        }
        return this;
    }

    private register(sortable: Sortable) {
        if (!this.registered.includes(sortable)) {
            this.registered.push(sortable);
        }
        this.sortables = topologicalSortList(this.registered);
        this.setSystems(filterSystems(this.sortables));
    }

    private addAnyMarker(marker: Marker): this {
        this.register(marker);
        return this;
    }

    /**
     * The names of the systems in the order they run. Two worlds that
     * must simulate in lockstep must agree on this list exactly (it is
     * not covered by state hashes); compare it the way the game-data
     * fingerprint is compared at join.
     */
    get systemNames(): string[] {
        return this.systems.map(system => system.name);
    }

    /**
     * Add a `Marker` to the world.
     *
     * `Marker`s can be placed in the `before` and `after` fields of Systems
     * (and other markers) to provide a reference for determining order. They
     * are topologically sorted along with `System`s (which themselves inherit
     * from `Marker`).
     */
    addMarker(...args: Marker[]): this {
        for (const marker of args) {
            if (marker instanceof System) {
                this.addSystem(marker);
            } else {
                this.addAnyMarker(marker);
            }
        }
        return this;
    }
    
    /**
     * Add a `SystemSet` to the world, including all the systems it contains.
     *
     * A `SystemSet` provides a convenient way to organize systems. Any system
     * in a `SystemSet` will be added to the world when the `SystemSet` is added.
     */
    addSystemSet(systemSet: SystemSet): this {
        this.addPhase(systemSet.phase);

        // Each addSystem re-sorts; fine, this is very rarely called.
        for (const system of systemSet.systems) {
            this.addSystem(system);
        }

        return this;
    }

    addPhase(phase: Phase): this {
        this.addMarker(phase.startMarker, phase.endMarker);
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
        const index = this.registered.indexOf(system);
        if (index >= 0) {
            this.registered.splice(index, 1);
        }
        this.sortables = topologicalSortList(this.registered);
        this.setSystems(filterSystems(this.sortables));

        return this;
    }

    /**
     * How many events are waiting in the queue (drained by the next
     * step). Exposed so snapshotting can check the "snapshots are taken
     * between steps, when the queue is empty" invariant.
     */
    get queuedEventCount(): number {
        return this.eventQueue.length;
    }

    /**
     * Flush the event queue.
     */
    /**
     * Discards all queued events. Used when restoring a snapshot:
     * entity removal/re-insertion during the restore queues Add/Delete
     * events that did not happen in the timeline being restored.
     * Snapshots are taken between steps, when the queue is empty, so
     * clearing it restores that invariant.
     */
    clearEventQueue() {
        this.eventQueue.length = 0;
    }

    private flush() {
        // Not a for loop because more events may be added as prior
        // ones are resolved.
        while (this.eventQueue.length > 0) {
            // FIFO: events run in emission order.
            const ecsEvent = this.eventQueue.shift()!;
            this.runEvent(ecsEvent);
        }
    }

    private setSystems(systems: Array<System>) {
        this.systems = systems;
        this.systemsByEvent.clear();
    }

    private systemsFor(event: UnknownEvent): System[] {
        let systems = this.systemsByEvent.get(event);
        if (!systems) {
            systems = this.systems.filter(s => s.events.has(event));
            this.systemsByEvent.set(event, systems);
        }
        return systems;
    }

    private runEvent(eventWithEntities: EcsEventWithEntities<unknown>) {
        const systems = this.systemsFor(eventWithEntities.event);
        if (systems.length === 0) {
            return;
        }

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
            // Cast like the branches above: a runtime `arg === X` check
            // cannot narrow the generic T.
            const getArg: GetArgFunction = <A extends ArgTypes = ArgTypes>(a: A) =>
                this.getArg<A>(a, entity, event);
            return right(getArg as ArgData<T>);
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
