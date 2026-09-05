import "jasmine";
import { Component, UnknownComponent } from "./component.js";
import { Entity } from "./entity.js";
import { EntityMapWithEvents } from './entity_map.js';

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

    // #87: re-setting the SAME entity object under its uuid used to
    // subscribe again without unsubscribing, so the old subscriptions
    // were unreachable and fired forever — N re-sets, N+1 emissions per
    // component write.
    it('emits each component event once after the same entity is re-set', () => {
        const entityMap = new EntityMapWithEvents();
        const entity = new Entity().addComponent(FooComponent, { x: 1 });
        entityMap.set('e', entity);
        entityMap.set('e', entity);
        entityMap.set('e', entity);

        let changes = 0;
        let changesAlways = 0;
        let adds = 0;
        let deletes = 0;
        entityMap.events.changeComponent.subscribe(() => changes++);
        entityMap.events.changeComponentAlways.subscribe(() => changesAlways++);
        entityMap.events.addComponent.subscribe(() => adds++);
        entityMap.events.deleteComponent.subscribe(() => deletes++);

        entity.components.set(FooComponent, { x: 2 });
        entity.components.set(BarComponent, { y: 'new' });
        entity.components.delete(BarComponent);

        expect(changes).toBe(2);
        expect(changesAlways).toBe(2);
        expect(adds).toBe(1);
        expect(deletes).toBe(1);
    });

    it('stops forwarding events from a replaced entity', () => {
        const entityMap = new EntityMapWithEvents();
        const old = new Entity().addComponent(FooComponent, { x: 1 });
        entityMap.set('e', old);
        entityMap.set('e', new Entity().addComponent(FooComponent, { x: 1 }));

        let changes = 0;
        entityMap.events.changeComponent.subscribe(() => changes++);
        old.components.set(FooComponent, { x: 2 });
        expect(changes).toBe(0);
    });
});
