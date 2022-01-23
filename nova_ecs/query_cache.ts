import { Either, isLeft, isRight, left, Right, right } from "fp-ts/lib/Either";
import { ArgsToData, ArgTypes, QueryResults } from "./arg_types";
import { Entity } from "./entity";
import { EntityMapWithEvents } from "./entity_map";
import { DeleteEvent, EcsEvent, StepEvent } from "./events";
import { Query } from "./query";
import { UnknownResource } from "./resource";
import { ResourceMapWrapped } from "./resource_map";
import { DefaultMap } from "./utils";
import { World } from "./world";


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
    private entities: Map<string, Entity>;
    private entityResults = new Map<Entity, ArgsToData<Args>>();
    private resources: Map<UnknownResource, unknown>;
    private wrappedResult: ArgsToData<Args>[] = []
    private resultValid = false;
    unsubscribe: () => void;

    private entitySupportedCacheHit = 0;
    private entitySupportedCacheMiss = 0;

    constructor(private queryCache: QueryCache,
        private query: Query,
        private getArg: World['getArg'],
        entities: EntityMapWithEvents,
        resources: ResourceMapWrapped) {
        this.entities = new Map([...entities].filter(
            ([, entity]) => query.supportsEntity(entity)));
        this.resources = new Map([...resources].filter(
            ([resource]) => query.resources.has(resource)));

        const supported = (query: Query, entity: Entity) => {
            const savedVal = entity.supportedQueries.get(query);
            if (savedVal) {
                this.entitySupportedCacheHit++;
                return true;
            } else if (savedVal === false) {
                this.entitySupportedCacheHit++;
                return false;
            }
            const newVal = query.supportsEntity(entity);
            entity.supportedQueries.set(query, newVal);
            this.entitySupportedCacheMiss++;
            return newVal;
        }

        const subscriptions = [
            entities.events.setAlways.subscribe(([uuid, entity]) => {
                if (this.entities.get(uuid) === entity) {
                    return;
                }
                if (supported(query, entity)) {
                    this.entities.set(uuid, entity);
                } else {
                    this.entities.delete(uuid);
                }
                this.entityResults.delete(entity);
                this.resultValid = false;
            }),
            entities.events.delete.subscribe((vals) => {
                for (const [uuid, entity] of vals) {
                    if (supported(query, entity)) {
                        this.resultValid = false;
                    }
                    this.entities.delete(uuid);
                    this.entityResults.delete(entity);
                }
            }),
            entities.events.addComponent.subscribe(([uuid, entity]) => {
                if (supported(query, entity)) {
                    this.entities.set(uuid, entity);
                }
                this.entityResults.delete(entity); // for `Optional` etc.
                this.resultValid = false;
            }),
            entities.events.changeComponentAlways.subscribe(([, entity]) => {
                this.entityResults.delete(entity);
                this.resultValid = false;
            }),
            entities.events.deleteComponent.subscribe(([uuid, entity, component]) => {
                if (query.components.has(component) && !supported(query, entity)) {
                    this.entities.delete(uuid);
                }
                this.entityResults.delete(entity);
                this.resultValid = false;
            }),
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
            }),
        ];

        this.unsubscribe = () => {
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }
        }
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
            supportedEntities = [...entities ?? this.entities.values()].filter(entity => {
                // Don't rely on the cached query when checking if the entity is supported
                // because the entity (and its entry in the cached query) may have already
                // been removed (e.g. in the case of DeleteEvent).
                return this.entities.has(entity.uuid) || this.query.supportsEntity(entity);
            });
        } else {
            supportedEntities = this.entities.values();
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
    constructor(entities: EntityMapWithEvents, resources: ResourceMapWrapped, getArg: World['getArg']) {
        super((query: Query) => new CachedQueryCacheEntry(this, query, getArg, entities, resources));
    }

    get<Args extends QueryArgsList>(query: Query<Args>): QueryCacheEntry<Args> {
        return super.get(query) as QueryCacheEntry<Args>;
    };

    set<Args extends QueryArgsList>(query: Query<Args>, entry: QueryCacheEntry<Args>): this {
        super.set(query, entry);
        return this;
    };

    has<Args extends QueryArgsList>(query: Query<Args>): boolean {
        return super.has(query);
    };

    delete<Args extends QueryArgsList>(query: Query<Args>): boolean {
        return super.delete(query);
    };
}
