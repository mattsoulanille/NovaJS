import "jasmine";
import { Component } from "./component";
import { Entity, EntityBuilder } from "./entity";
import { EntityMapWrapped } from './entity_map';

const FooComponent = new Component<{ x: number }>('foo');
const BarComponent = new Component<{ y: string }>('bar');

describe('entity map', () => {
    it('emits when a component is added to an entity', async () => {
        const entityMap = new EntityMapWrapped();
        const changed = new Promise<[string, Entity]>((fulfill) => {
            entityMap.events.change.subscribe(fulfill);
        });

        const entity = new EntityBuilder().build();
        entityMap.set('testEntity', entity);

        entity.components.set(BarComponent, { y: 'hello' });

        await expectAsync(changed).toBeResolvedTo(['testEntity', entity]);
    });

    it('emits when a component is removed from an entity', async () => {
        const entityMap = new EntityMapWrapped();
        const changed = new Promise<[string, Entity]>((fulfill) => {
            entityMap.events.change.subscribe(fulfill);
        });

        const entity = new EntityBuilder()
            .addComponent(BarComponent, { y: 'hello' })
            .build();
        entityMap.set('testEntity', entity);

        entity.components.delete(BarComponent);

        await expectAsync(changed).toBeResolvedTo(['testEntity', entity]);
    });

    it('does not emit when a component is replaced', async () => {
        const entityMap = new EntityMapWrapped();
        let called = false;
        const changed = new Promise<[string, Entity]>((fulfill) => {
            entityMap.events.change.subscribe(v => {
                called = true;
                fulfill(v);
            });
        });

        const entity = new EntityBuilder()
            .addComponent(BarComponent, { y: 'hello' })
            .build();
        entityMap.set('testEntity', entity);

        entity.components.set(BarComponent, { y: 'bye' });
        expect(called).toBeFalse();
        entity.components.set(FooComponent, { x: 123 });
        expect(called).toBeTrue();

        await expectAsync(changed).toBeResolvedTo(['testEntity', entity]);
    });
});
