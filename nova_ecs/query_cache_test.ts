import { right } from 'fp-ts/lib/Either';
import 'jasmine';
import { Component } from './component';
import { EntityBuilder } from './entity';
import { EntityMapWrapped } from './entity_map';
import { Query } from './query';
import { QueryCache } from './query_cache';
import { World } from './world';

const FooComponent = new Component<{ x: number }>('FooComponent');
const BarComponent = new Component<{ y: string }>('BarComponent');

describe('query cache', () => {
    let entities: EntityMapWrapped;
    let getArg: jasmine.Spy<World['getArg']>;
    let queryCache: QueryCache;
    beforeEach(() => {
        entities = new EntityMapWrapped();
        getArg = jasmine.createSpy<World['getArg']>();
        queryCache = new QueryCache(entities, getArg);
    });

    it('creates an entry for a requested query', () => {
        const query = new Query([FooComponent]);
        const cached = queryCache.get(query);
        expect(cached).toBeDefined();
    });

    xit('gets query args for each supported entity', () => {
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
});
