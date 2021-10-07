import { Either, isLeft, isRight, left, Right, right } from "fp-ts/lib/Either";
import { ArgsToData, ArgTypes, QueryResults } from "./arg_types";
import { Entity } from "./entity";
import { EntityMapWrapped } from "./entity_map";
import { DeleteEvent, EcsEvent, StepEvent } from "./events";
import { Query } from "./query";
import { DefaultMap } from "./utils";
import { World } from "./world";


class QueryCacheEntry<Args extends readonly ArgTypes[] = readonly ArgTypes[]> {
    entities: Map<string, Entity>;
    private entityResults = new Map<Entity, ArgsToData<Args>>();
    private wrappedResult: ArgsToData<Args>[] = []
    private resultValid = false;
    unsubscribe: () => void;

    constructor(private queryCache: QueryCache,
        private query: Query,
        private getArg: World['getArg'],
        entities: EntityMapWrapped) {
        this.entities = new Map([...entities].filter(
            ([, entity]) => query.supportsEntity(entity)));

        const subscriptions = [
            entities.events.setAlways.subscribe(([uuid, entity]) => {
                if (this.entities.get(uuid) === entity) {
                    return;
                }
                if (query.supportsEntity(entity)) {
                    this.entities.set(uuid, entity);
                } else {
                    this.entities.delete(uuid);
                }
                this.entityResults.delete(entity);
                this.resultValid = false;
            }),
            entities.events.delete.subscribe((vals) => {
                for (const [uuid, entity] of vals) {
                    if (query.supportsEntity(entity)) {
                        this.resultValid = false;
                    }
                    this.entities.delete(uuid);
                    this.entityResults.delete(entity);
                }
            }),
            entities.events.addComponent.subscribe(([uuid, entity]) => {
                if (query.supportsEntity(entity)) {
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
                if (query.components.has(component) && !query.supportsEntity(entity)) {
                    this.entities.delete(uuid);
                }
                this.entityResults.delete(entity);
                this.resultValid = false;
            }),
        ];

        this.unsubscribe = () => {
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }
        }
    }

    getResultForEntity(entity: Entity, uuid: string,
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
                const results = this.query.args.map(arg => this.getArg(arg, entity, uuid, event));
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
        entities?: Iterable<[string, Entity]>,
        event?: readonly [EcsEvent<unknown>, unknown],
    } = {}): QueryResults<Query<Args>> {

        // Only use the cache if the event is a step event and there are
        // no entities specified (i.e. use all entities).
        const isStep = event ? event[0] === StepEvent : true;

        if (isStep && !entities && this.valid) {
            return this.wrappedResult;
        }

        let supportedEntities: [string, Entity][];
        if (entities || event?.[0] === DeleteEvent) {
            supportedEntities = [...entities ?? this.entities].filter(([uuid, entity]) => {
                // Don't rely on the cached query for DeleteEvent because
                // the entity (and its entry in the cached query) have already
                // been removed.
                if (event?.[0] === DeleteEvent) {
                    return this.query.supportsEntity(entity);
                }
                return this.entities.has(uuid);
            });
        } else {
            supportedEntities = [...this.entities];
        }

        const queryResults = supportedEntities.map(([uuid, entity]) =>
            [entity, this.getResultForEntity(entity, uuid, event)] as const)
            .filter((results): results is [Entity, Right<ArgsToData<Args>>] => isRight(results[1]))
            .map(rightResults => rightResults[1].right);


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

type QueryArgsList = readonly ArgTypes[];
export class QueryCache extends DefaultMap<Query, QueryCacheEntry> {
    constructor(entities: EntityMapWrapped, getArg: World['getArg']) {
        super((query: Query) => new QueryCacheEntry(this, query, getArg, entities));
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
