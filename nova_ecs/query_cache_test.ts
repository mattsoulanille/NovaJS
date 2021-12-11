import { right } from 'fp-ts/lib/Either';
import 'jasmine';
import { Component } from './component';
import { EntityBuilder } from './entity';
import { EntityMapWrapped } from './entity_map';
import { Query } from './query';
import { QueryCache } from './query_cache';
import { Resource } from './resource';
import { ResourceMapWrapped } from './resource_map';
import { World } from './world';

const FooComponent = new Component<{ x: number }>('FooComponent');
const BarComponent = new Component<{ y: string }>('BarComponent');
const BazResource = new Resource<{ z: string[] }>('baz');

describe('query cache', () => {
    let entities: EntityMapWrapped;
    let resources: ResourceMapWrapped;
    let getArg: jasmine.Spy<World['getArg']>;
    let queryCache: QueryCache;
    beforeEach(() => {
        entities = new EntityMapWrapped();
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
        const e1 = new EntityBuilder()
            .addComponent(FooComponent, { x: 123 })
            .build();
        entities.set('e1', e1);
        const e2 = new EntityBuilder()
            .addComponent(FooComponent, { x: 456 })
            .build();
        entities.set('e2', e2);
        const e3 = new EntityBuilder()
            .addComponent(BarComponent, { y: 'hello' })
            .build();
        entities.set('e3', e3);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));
        cached.getResult();
        expect(getArg).toHaveBeenCalledWith(FooComponent, e1, 'e1', undefined);
        expect(getArg).toHaveBeenCalledWith(FooComponent, e2, 'e2', undefined);
    });

    it('caches results', () => {
        const query = new Query([FooComponent]);
        const e1 = new EntityBuilder()
            .addComponent(FooComponent, { x: 123 })
            .build();
        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));

        cached.getResult();
        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);
    });

    it('uses cache when an entity is set to the same value', () => {
        const query = new Query([FooComponent]);
        const e1 = new EntityBuilder()
            .addComponent(FooComponent, { x: 123 })
            .build();
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
        const e1 = new EntityBuilder()
            .addComponent(FooComponent, { x: 123 })
            .build();
        entities.set('e1', e1);

        const cached = queryCache.get(query);
        getArg.and.returnValue(right({ x: 0 }));

        cached.getResult();
        expect(getArg).toHaveBeenCalledTimes(1);

        entities.set('e1', new EntityBuilder()
            .addComponent(FooComponent, { x: 123 })
            .build());
        cached.getResult();

        expect(getArg).toHaveBeenCalledTimes(2);
    });

    it('uses cache when a resource is set to the same value', () => {
        const query = new Query([BazResource]);
        const e1 = new EntityBuilder().build();
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
        const e1 = new EntityBuilder().build();
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
});
