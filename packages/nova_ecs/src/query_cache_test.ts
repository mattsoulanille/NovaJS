import { right } from 'fp-ts/lib/Either.js';
import 'jasmine';
import { Component } from './component.js';
import { Entity } from './entity.js';
import { EntityMapWithEvents } from './entity_map.js';
import { Query } from './query.js';
import { QueryCache } from './query_cache.js';
import { Resource } from './resource.js';
import { ResourceMapWrapped } from './resource_map.js';
import { World } from './world.js';

const FooComponent = new Component<{ x: number }>('FooComponent');
const BarComponent = new Component<{ y: string }>('BarComponent');
const BazResource = new Resource<{ z: string[] }>('baz');

describe('query cache', () => {
    let entities: EntityMapWithEvents;
    let resources: ResourceMapWrapped;
    let getArg: jasmine.Spy<World['getArg']>;
    let queryCache: QueryCache;
    beforeEach(() => {
        entities = new EntityMapWithEvents();
        resources = new ResourceMapWrapped(() => { }, () => true);
        getArg = jasmine.createSpy<World['getArg']>('getArg');
        queryCache = new QueryCache(entities, resources, getArg);
    });

    it('creates an entry for a requested query', () => {
        const query = new Query([FooComponent]);
        const cached = queryCache.get(query);
        expect(cached).toBeDefined();
    });

    it('gets query args for each supported entity', () => {
        const query = new Query([FooComponent]);
        const e1 = new Entity()
            .addComponent(FooComponent, { x: 123 });

        entities.set('e1', e1);
        const e2 = new Entity()
            .addComponent(FooComponent, { x: 456 });

        entities.set('e2', e2);
        const e3 = new Entity()
            .addComponent(BarComponent, { y: 'hello' });

        entities.set('e3', e3);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));
        cached.getResult();
        expect(getArg).toHaveBeenCalledWith(FooComponent, e1, undefined);
        expect(getArg).toHaveBeenCalledWith(FooComponent, e2, undefined);
    });

    it('caches results', () => {
        const query = new Query([FooComponent]);
        const e1 = new Entity()
            .addComponent(FooComponent, { x: 123 });

        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));

        cached.getResult();
        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);
    });

    it('uses cache when an entity is set to the same value', () => {
        const query = new Query([FooComponent]);
        const e1 = new Entity()
            .addComponent(FooComponent, { x: 123 });

        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));

        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);

        entities.set('e1', e1);
        cached.getResult();

        expect(getArg).toHaveBeenCalledTimes(1);
    });

    it('invalidates cache when an entity is set to a different value', () => {
        const query = new Query([FooComponent]);
        const e1 = new Entity()
            .addComponent(FooComponent, { x: 123 });

        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));

        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);

        entities.set('e1', new Entity()
            .addComponent(FooComponent, { x: 123 }));

        cached.getResult();

        expect(getArg).toHaveBeenCalledTimes(2);
    });

    it('uses cache when a resource is set to the same value', () => {
        const query = new Query([BazResource]);
        const e1 = new Entity();
        entities.set('e1', e1);
        const resourceVal = { z: ['foo', 'bar'] };
        resources.set(BazResource, resourceVal);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));

        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);

        resources.set(BazResource, resourceVal);
        cached.getResult();

        expect(getArg).toHaveBeenCalledTimes(1);
    });

    it('invalidates the cache when a resource changes', () => {
        const query = new Query([BazResource]);
        const e1 = new Entity();
        entities.set('e1', e1);
        resources.set(BazResource, { z: ['foo', 'bar'] });

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));

        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);

        resources.set(BazResource, { z: ['foo', 'bar'] });
        cached.getResult();

        expect(getArg).toHaveBeenCalledTimes(2);
    });

    // Pins for component-indexed invalidation: component events must
    // invalidate exactly the queries whose staleness set
    // (referencedComponents) contains the component.
    it('does not invalidate when an irrelevant component changes', () => {
        const query = new Query([FooComponent]);
        const e1 = new Entity()
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'hello' });
        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));
        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);

        // BarComponent is not in the query's staleness set.
        e1.components.set(BarComponent, { y: 'changed' });
        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);
    });

    it('invalidates when a required component changes', () => {
        const query = new Query([FooComponent]);
        const e1 = new Entity()
            .addComponent(FooComponent, { x: 123 });
        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));
        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);

        e1.components.set(FooComponent, { x: 456 });
        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(2);
    });

    it('gains membership when the last required component is added', () => {
        const query = new Query([FooComponent, BarComponent]);
        const e1 = new Entity()
            .addComponent(FooComponent, { x: 123 });
        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));
        expect(cached.getResult().length).toBe(0);

        e1.components.set(BarComponent, { y: 'hello' });
        expect(cached.getResult().length).toBe(1);
    });

    it('loses membership when a required component is deleted', () => {
        const query = new Query([FooComponent, BarComponent]);
        const e1 = new Entity()
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'hello' });
        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));
        expect(cached.getResult().length).toBe(1);

        e1.components.delete(BarComponent);
        expect(cached.getResult().length).toBe(0);
    });

    // #41: member order must be a function of world state (the world
    // map's insertion order), not of the order in which entities gained
    // the query's components.
    it('visits members in world order after a member leaves and rejoins', () => {
        const query = new Query([FooComponent]);
        const a = new Entity().addComponent(FooComponent, { x: 1 });
        const b = new Entity().addComponent(FooComponent, { x: 2 });
        entities.set('a', a);
        entities.set('b', b);
        const cached = queryCache.get(query);
        getArg.and.callFake(((_arg: unknown, entity: Entity) =>
            right(entity)) as unknown as World['getArg']);

        expect(cached.getResult().map(([e]) => e as unknown as Entity)).toEqual([a, b]);

        a.components.delete(FooComponent);
        a.components.set(FooComponent, { x: 1 });
        expect(cached.getResult().map(([e]) => e as unknown as Entity)).toEqual([a, b]);

        // And for a query that only gains members after creation.
        const late = new Query([FooComponent, BarComponent]);
        const cachedLate = queryCache.get(late);
        b.components.set(BarComponent, { y: 'b' });
        a.components.set(BarComponent, { y: 'a' });
        expect(cachedLate.getResult().map(([e]) => e as unknown as Entity)).toEqual([a, b]);
    });

    it('drops a replaced entity the new object does not support', () => {
        // Rollback snapshot restore reuses uuids with fresh entity
        // objects; an entry that held the old object must drop it even
        // when the replacement does not match the query.
        const query = new Query([FooComponent]);
        const e1 = new Entity()
            .addComponent(FooComponent, { x: 123 });
        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));
        expect(cached.getResult().length).toBe(1);

        entities.set('e1', new Entity()
            .addComponent(BarComponent, { y: 'hello' }));
        expect(cached.getResult().length).toBe(0);
    });
});
