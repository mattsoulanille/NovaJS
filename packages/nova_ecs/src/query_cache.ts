import { Either, isLeft, isRight, left, Right, right } from "fp-ts/lib/Either.js";
import { ArgsToData, ArgTypes, QueryResults } from "./arg_types.js";
import { UnknownComponent } from "./component.js";
import { Entity } from "./entity.js";
import { EntityMapWithEvents } from "./entity_map.js";
import { DeleteEvent, EcsEvent, StepEvent } from "./events.js";
import { Query } from "./query.js";
import { UnknownResource } from "./resource.js";
import { ResourceMapWrapped } from "./resource_map.js";
import { DefaultMap } from "./utils.js";
import { World } from "./world.js";


interface QueryCacheEntry<Args extends readonly ArgTypes[] = readonly ArgTypes[]> {
    readonly valid: boolean;
    unsubscribe: () => void;
    getResultForEntity(entity: Entity,
        event?: readonly [EcsEvent<unknown>, unknown]): Either<undefined, ArgsToData<Args>>;
    getResult(args?: {
        entities?: Iterable<Entity>,
        event?: readonly [EcsEvent<unknown>, unknown],
    }): QueryResults<Query<Args>>;
}

class CachedQueryCacheEntry<Args extends readonly ArgTypes[] = readonly ArgTypes[]> {
    /**
     * Members, kept in `Entity.insertionOrder` (= world map) order so
     * that the order a per-entity system visits them is a function of
     * world state, not of the order in which they gained the query's
     * components (#41). A member that leaves and rejoins (a component
     * deleted and re-added) would otherwise land at the END of this
     * map, and snapshot restore — which rebuilds every entry in world
     * order — would then silently change the visitation order on the
     * peer that rolled back. Appends in order are the common case and
     * cost nothing; only an out-of-order join marks the map for a
     * re-sort at the next refill (`members()`).
     *
     * Cost of that re-sort: O(k log k) over the k members plus a fresh
     * Map, paid at most once per getResult after a dirtying join. A
     * query whose membership churns in alternating order every tick
     * (e.g. a target acquired and dropped across ships) can therefore
     * re-sort per tick; bounded by the query's size and, measured on
     * the 600-step determinism run, not visible. If a hot query ever
     * shows up here, an ordered structure (or inserting at the sorted
     * position) replaces the sort without changing the order contract.
     */
    private entities: Map<string, Entity>;
    /** Highest insertionOrder ever appended; a join below it is out of order. */
    private maxOrder = -1;
    private orderDirty = false;
    private entityResults = new Map<Entity, ArgsToData<Args>>();
    private resources: Map<UnknownResource, unknown>;
    private wrappedResult: ArgsToData<Args>[] = []
    private resultValid = false;
    unsubscribe: () => void;

    constructor(private queryCache: QueryCache,
        readonly query: Query,
        private getArg: World['getArg'],
        entities: EntityMapWithEvents,
        resources: ResourceMapWrapped) {
        // The world map is already in insertionOrder.
        this.entities = new Map([...entities].filter(
            ([, entity]) => query.supportsEntity(entity)));
        for (const entity of this.entities.values()) {
            this.maxOrder = entity.insertionOrder;
        }
        this.resources = new Map([...resources].filter(
            ([resource]) => query.resources.has(resource)));

        // Entity and component events are dispatched by the QueryCache,
        // which routes each component event only to the entries whose
        // staleness set (query.referencedComponents) contains that
        // component — see QueryCache. Resource events are rare, so each
        // entry subscribes directly.
        queryCache.register(this);
        const resourceSubscription =
            resources.events.setAlways.subscribe(([resource, val]) => {
                if (!query.resources.has(resource)) {
                    // Don't need to care about or track resources
                    // that the query doesn't use.
                    return;
                }
                if (this.resources.get(resource) === val) {
                    return;
                }
                this.resources.set(resource, val);
                // Resources are global, so delete all cached results for entities.
                this.entityResults.clear();
                this.resultValid = false;
            });

        this.unsubscribe = () => {
            this.queryCache.unregister(this);
            resourceSubscription.unsubscribe();
        }
    }

    // The former per-(entity, query) `supportedQueries` memo is gone:
    // supportsEntity is a BinSet subset test (a few integer ops), which
    // profiles faster than the Map get/set churn the memo cost — the
    // memo was also cleared on every component add/delete, so churn-
    // heavy workloads (submunitions) mostly missed it.
    private supported(entity: Entity) {
        return this.query.supportsEntity(entity);
    }

    /**
     * Adds (or replaces) a member. A replacement keeps its Map position
     * and inherited insertionOrder, so only a NEW member can be out of
     * order — and checking `has` first keeps the hot component-add path
     * (a member gaining an Optional component) from marking the map
     * dirty spuriously.
     */
    private addMember(uuid: string, entity: Entity) {
        if (!this.entities.has(uuid)) {
            const order = entity.insertionOrder;
            if (order < this.maxOrder) {
                this.orderDirty = true;
            } else {
                this.maxOrder = order;
            }
        }
        this.entities.set(uuid, entity);
    }

    /** The members in insertionOrder, re-sorting first if a join was out of order. */
    private members(): IterableIterator<Entity> {
        if (this.orderDirty) {
            this.entities = new Map([...this.entities].sort(
                ([, a], [, b]) => a.insertionOrder - b.insertionOrder));
            this.orderDirty = false;
        }
        return this.entities.values();
    }

    onEntitySet(uuid: string, entity: Entity) {
        if (this.supported(entity)) {
            if (this.entities.get(uuid) === entity) {
                return;
            }
            this.addMember(uuid, entity);
        } else if (!this.entities.delete(uuid)) {
            // Was not a member and still is not: nothing changed.
            return;
        }
        this.entityResults.delete(entity);
        this.resultValid = false;
    }

    onEntityDeleted(uuid: string, entity: Entity) {
        // Membership is tracked in this.entities, so consulting it
        // beats re-testing supportsEntity: only a deleted MEMBER
        // invalidates the cached result list.
        if (this.entities.delete(uuid)) {
            this.resultValid = false;
        }
        this.entityResults.delete(entity);
    }

    onComponentAdded(uuid: string, entity: Entity) {
        if (this.supported(entity)) {
            this.addMember(uuid, entity);
        }
        this.entityResults.delete(entity); // for `Optional` etc.
        this.resultValid = false;
    }

    onComponentChanged(entity: Entity) {
        this.entityResults.delete(entity);
        this.resultValid = false;
    }

    onComponentDeleted(uuid: string, entity: Entity,
        component: UnknownComponent) {
        if (this.query.components.has(component) && !this.supported(entity)) {
            this.entities.delete(uuid);
        }
        this.entityResults.delete(entity);
        this.resultValid = false;
    }

    getResultForEntity(entity: Entity,
        event?: readonly [EcsEvent<unknown>, unknown]): Either<undefined, ArgsToData<Args>> {

        const isStep = event ? event[0] === StepEvent : true;
        if (isStep && this.entityResults.has(entity)) {
            // Update referenced queries
            for (const arg of this.query.queries) {
                const cached = this.queryCache.get(arg);
                cached.getResult();
            }
            // Return from cache
            return right(this.entityResults.get(entity)!);
        } else {
            // Create cache entry / result for entity.
            try {
                const results = this.query.args.map(arg => this.getArg(arg, entity, event));
                const rightResults: unknown[] = [];
                for (const result of results) {
                    if (isLeft(result)) {
                        return left(undefined);
                    }
                    rightResults.push(result.right);
                }

                const result = rightResults as unknown as ArgsToData<Args>;

                if (isStep) {
                    this.entityResults.set(entity, result);
                }
                return right(result);
            } catch (e) {
                if (!(e instanceof Error)) {
                    throw e;
                } else {
                    e.message = `${e.message} at query ${this.query.name}`;
                    throw e;
                }
            }
        }
    }

    getResult({ entities, event }: {
        entities?: Iterable<Entity>,
        event?: readonly [EcsEvent<unknown>, unknown],
    } = {}): QueryResults<Query<Args>> {

        // Only use the cache if the event is a step event and there are
        // no entities specified (i.e. use all entities).
        const isStep = event ? event[0] === StepEvent : true;

        if (isStep && !entities && this.valid) {
            return this.wrappedResult;
        }

        let supportedEntities: Iterable<Entity>;
        if (entities || event?.[0] === DeleteEvent) {
            supportedEntities = [...entities ?? this.members()].filter(entity => {
                // Don't rely on the cached query when checking if the entity is supported
                // because the entity (and its entry in the cached query) may have already
                // been removed (e.g. in the case of DeleteEvent).
                return this.entities.has(entity.uuid) || this.query.supportsEntity(entity);
            });
        } else {
            supportedEntities = this.members();
        }

        const queryResults: QueryResults<Query<Args>> = [];
        for (const entity of supportedEntities) {
            const result = this.getResultForEntity(entity, event);
            if (isLeft(result)) {
                continue;
            }
            queryResults.push(result.right);
        }

        // Don't cache events other than Step
        if (!isStep || entities) {
            return queryResults;
        }

        // We use the same wrappedResult instead of reassigning it because
        // otherwise, we'd have to update the references of all queries
        // that depend on this query.
        this.wrappedResult.length = 0;
        for (let i = 0; i < queryResults.length; i++) {
            this.wrappedResult[i] = queryResults[i];
        }

        this.resultValid = true;
        return this.wrappedResult;
    }

    get valid() {
        if (!this.resultValid) {
            return false;
        }
        for (const arg of this.query.args) {
            if (arg instanceof Query && !this.queryCache.get(arg).valid) {
                return false;
            }
        }
        return true;
    }
}

class CachelessQueryCacheEntry<Args extends readonly ArgTypes[] = readonly ArgTypes[]> implements QueryCacheEntry<Args> {

    readonly valid = true;

    constructor(private queryCache: QueryCache,
        private query: Query,
        private getArg: World['getArg'],
        private entities: EntityMapWithEvents,
        private resources: ResourceMapWrapped) {
    }

    unsubscribe = () => { };

    getResultForEntity(entity: Entity,
        event?: readonly [EcsEvent<unknown>, unknown]): Either<undefined, ArgsToData<Args>> {
        try {
            const results = this.query.args.map(arg => this.getArg(arg, entity, event));
            const rightResults: unknown[] = [];
            for (const result of results) {
                if (isLeft(result)) {
                    return left(undefined);
                }
                rightResults.push(result.right);
            }

            const result = rightResults as unknown as ArgsToData<Args>;
            return right(result);
        } catch (e) {
            if (!(e instanceof Error)) {
                throw e;
            } else {
                e.message = `${e.message} at query ${this.query.name}`;
                throw e;
            }
        }
    }
    getResult({ entities, event }: {
        entities?: Iterable<Entity>,
        event?: readonly [EcsEvent<unknown>, unknown],
    } = {}): ArgsToData<Args>[] {
        const supportedEntities = [...entities ?? this.entities.values()].filter(
            entity => this.query.supportsEntity(entity));

        const queryResults = supportedEntities.map(entity =>
            [entity, this.getResultForEntity(entity, event)] as const)
            .filter((results): results is [Entity, Right<ArgsToData<Args>>] => isRight(results[1]))
            .map(rightResults => rightResults[1].right);

        return queryResults;
    }
}

type QueryArgsList = readonly ArgTypes[];
export class QueryCache extends DefaultMap<Query, QueryCacheEntry> {
    /**
     * Component-indexed event dispatch. Entity-level events (an entity
     * set or deleted) go to every entry, but component events — by far
     * the most frequent, since every component write on every entity
     * emits one — go only to the entries whose staleness set
     * (query.referencedComponents) contains that component. Entries
     * with an unknown staleness set (`null`) are wildcards and receive
     * every component event, preserving the old conservative behavior.
     * This replaces per-entry subscriptions, which made every component
     * write cost O(number of cached queries).
     */
    /** Entries whose query requires no components: candidates for
     * every entity set/delete. */
    private matchAllEntries = new Set<CachedQueryCacheEntry>();
    /** Non-empty queries, indexed under ONE designated required
     * component: an entity that lacks it can neither become a member
     * nor have one of the entry's cached tuples. */
    private designatedEntries =
        new Map<UnknownComponent, Set<CachedQueryCacheEntry>>();
    /** Mirror of the world's entity map, one event behind its own
     * subscription: gives the setAlways handler the entity object a
     * uuid previously mapped, which the event does not carry. */
    private shadowEntities = new Map<string, Entity>();
    private wildcardEntries = new Set<CachedQueryCacheEntry>();
    private componentEntries =
        new DefaultMap<UnknownComponent, Set<CachedQueryCacheEntry>>(
            () => new Set());

    constructor(entities: EntityMapWithEvents, resources: ResourceMapWrapped, getArg: World['getArg']) {
        super((query: Query) => new CachedQueryCacheEntry(this, query, getArg, entities, resources));
        for (const [uuid, entity] of entities) {
            this.shadowEntities.set(uuid, entity);
        }
        entities.events.setAlways.subscribe(([uuid, entity]) => {
            const previous = this.shadowEntities.get(uuid);
            if (previous === entity) {
                // Same object re-set: membership and cached tuples are
                // keyed by identity, so nothing can change (every entry
                // would early-out).
                return;
            }
            this.shadowEntities.set(uuid, entity);
            for (const entry of this.matchAllEntries) {
                entry.onEntitySet(uuid, entity);
            }
            for (const component of entity.components.keys()) {
                const bucket = this.designatedEntries.get(component);
                if (bucket === undefined) continue;
                for (const entry of bucket) {
                    entry.onEntitySet(uuid, entity);
                }
            }
            if (previous !== undefined) {
                // The uuid previously mapped a different entity object
                // (e.g. a rollback snapshot restore): entries that held
                // the OLD entity must drop it even though the new one
                // does not select them. A member always carries all of
                // its query's components (membership is maintained
                // eagerly on component deletes), so sweeping the old
                // entity's current components reaches every such entry.
                for (const component of previous.components.keys()) {
                    const bucket = this.designatedEntries.get(component);
                    if (bucket === undefined) continue;
                    for (const entry of bucket) {
                        entry.onEntitySet(uuid, entity);
                    }
                }
            }
        });
        entities.events.delete.subscribe(vals => {
            for (const [uuid, entity] of vals) {
                this.shadowEntities.delete(uuid);
                for (const entry of this.matchAllEntries) {
                    entry.onEntityDeleted(uuid, entity);
                }
                for (const component of entity.components.keys()) {
                    const bucket = this.designatedEntries.get(component);
                    if (bucket === undefined) continue;
                    for (const entry of bucket) {
                        entry.onEntityDeleted(uuid, entity);
                    }
                }
            }
        });
        entities.events.addComponent.subscribe(([uuid, entity, component]) => {
            for (const entry of this.componentEntries.get(component)) {
                entry.onComponentAdded(uuid, entity);
            }
            for (const entry of this.wildcardEntries) {
                entry.onComponentAdded(uuid, entity);
            }
        });
        entities.events.changeComponentAlways.subscribe(([, entity, component]) => {
            for (const entry of this.componentEntries.get(component)) {
                entry.onComponentChanged(entity);
            }
            for (const entry of this.wildcardEntries) {
                entry.onComponentChanged(entity);
            }
        });
        entities.events.deleteComponent.subscribe(([uuid, entity, component]) => {
            for (const entry of this.componentEntries.get(component)) {
                entry.onComponentDeleted(uuid, entity, component);
            }
            for (const entry of this.wildcardEntries) {
                entry.onComponentDeleted(uuid, entity, component);
            }
        });
    }

    // Entity set/delete dispatch (see the constructor) sweeps
    // matchAllEntries plus the designated bucket of each component the
    // entity carries. Membership needs ALL of a query's required
    // components, so an entry indexed under a designated component the
    // entity lacks can neither gain the entity as a member nor hold a
    // cached tuple for it (tuples only exist for entities that were
    // members at fill time, and eager maintenance removes both on the
    // component-indexed delete path).
    register(entry: CachedQueryCacheEntry) {
        const components = entry.query.components;
        if (components.size === 0) {
            this.matchAllEntries.add(entry);
        } else {
            const designated: UnknownComponent =
                components.values().next().value!;
            let bucket = this.designatedEntries.get(designated);
            if (bucket === undefined) {
                bucket = new Set();
                this.designatedEntries.set(designated, bucket);
            }
            bucket.add(entry);
        }
        const referenced = entry.query.referencedComponents;
        if (referenced === null) {
            this.wildcardEntries.add(entry);
        } else {
            for (const component of referenced) {
                this.componentEntries.get(component).add(entry);
            }
        }
    }

    unregister(entry: CachedQueryCacheEntry) {
        this.matchAllEntries.delete(entry);
        const components = entry.query.components;
        if (components.size > 0) {
            const designated: UnknownComponent =
                components.values().next().value!;
            this.designatedEntries.get(designated)?.delete(entry);
        }
        this.wildcardEntries.delete(entry);
        const referenced = entry.query.referencedComponents;
        if (referenced !== null) {
            for (const component of referenced) {
                this.componentEntries.get(component).delete(entry);
            }
        }
    }

    override get<Args extends QueryArgsList>(query: Query<Args>): QueryCacheEntry<Args> {
        return super.get(query) as QueryCacheEntry<Args>;
    };

    override set<Args extends QueryArgsList>(query: Query<Args>, entry: QueryCacheEntry<Args>): this {
        super.set(query, entry);
        return this;
    };

    override has<Args extends QueryArgsList>(query: Query<Args>): boolean {
        return super.has(query);
    };

    override delete<Args extends QueryArgsList>(query: Query<Args>): boolean {
        return super.delete(query);
    };
}
