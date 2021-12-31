import "jasmine";
import { Component, UnknownComponent } from "./component";
import { Entity } from "./entity";
import { EntityMapWithEvents } from './entity_map';

const FooComponent = new Component<{ x: number }>('foo');
const BarComponent = new Component<{ y: string }>('bar');

describe('entity map', () => {
    it('emits when a component is added to an entity', async () => {
        const entityMap = new EntityMapWithEvents();
        const changed = new Promise<[string, Entity, UnknownComponent]>((fulfill) => {
            entityMap.events.addComponent.subscribe(fulfill);
        });

        const entity = new Entity();
        entityMap.set('testEntity', entity);

        entity.components.set(BarComponent, { y: 'hello' });

        await expectAsync(changed).toBeResolvedTo(['testEntity', entity, BarComponent]);
    });

    it('emits when a component is removed from an entity', async () => {
        const entityMap = new EntityMapWithEvents();
        const changed = new Promise<[string, Entity, UnknownComponent]>((fulfill) => {
            entityMap.events.deleteComponent.subscribe(fulfill);
        });

        const entity = new Entity()
            .addComponent(BarComponent, { y: 'hello' });
        entityMap.set('testEntity', entity);

        entity.components.delete(BarComponent);

        await expectAsync(changed).toBeResolvedTo(['testEntity', entity, BarComponent]);
    });

    it('does not emit when a component is replaced', async () => {
        const entityMap = new EntityMapWithEvents();
        let called = false;
        const changed = new Promise<[string, Entity, UnknownComponent]>((fulfill) => {
            entityMap.events.addComponent.subscribe(v => {
                called = true;
                fulfill(v);
            });
        });

        const entity = new Entity()
            .addComponent(BarComponent, { y: 'hello' });
        entityMap.set('testEntity', entity);

        entity.components.set(BarComponent, { y: 'bye' });
        expect(called).toBeFalse();
        entity.components.set(FooComponent, { x: 123 });
        expect(called).toBeTrue();

        await expectAsync(changed).toBeResolvedTo(['testEntity', entity, FooComponent]);
    });
});
