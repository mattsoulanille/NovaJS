import * as t from "io-ts";
import { Component } from "nova_ecs/component";
import { Entity } from "nova_ecs/entity";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { applyChanges, Change, ChangesEvent, ChangesResource, CopyChangeDetector, create, DetectChanges, RecordSystems, remove, update } from "./copy_change_detector";
import { Serializer, SerializerPlugin, SerializerResource } from "./serializer_plugin";

const FOO_COMPONENT = new Component<{ x: number }>('foo');
const BAR_COMPONENT = new Component<{ y: string }>('bar');
const IncrementFoo = new System({
    name: 'IncrementFoo',
    args: [FOO_COMPONENT] as const,
    before: [DetectChanges],
    step(foo) {
        foo.x++;
    }
});

describe('copy change detector', () => {
    let world1: World;
    let world2: World;
    let changes: Change[][];
    let fooEntity: Entity;
    let serializer: Serializer;
    let recordSystems: (add: () => void) => void;

    beforeEach(() => {
        world1 = new World('world1');
        world2 = new World('world2');

        for (const world of [world1, world2]) {
            world.addPlugin(SerializerPlugin);
            world.addPlugin(CopyChangeDetector);
        
            serializer = world.resources.get(SerializerResource)!;
            serializer.addComponent(FOO_COMPONENT, t.type({x: t.number}))
        }
        
        recordSystems = world1.resources.get(RecordSystems)!;

        changes = []
        world1.events.get(ChangesEvent).subscribe((c) => {
            changes.push(c);
        });

        fooEntity = new Entity('testEntity')
            .addComponent(FOO_COMPONENT, {x: 123});
    });

    it('reports nothing when nothing changes', () => {
        world1.step();
        world1.step();
        expect(changes).toEqual([]);

    });

    it('reports when an entity is added', () => {
        world1.entities.set('fooEntity', fooEntity);
        world1.step();
        world1.step();
        world1.step();
        expect(changes).toEqual([
            [create(fooEntity, serializer)]
        ]);
    });

    it('reports when an entity is removed', () => {
        world1.entities.set('fooEntity', fooEntity);
        world1.step();
        world1.entities.delete('fooEntity');
        world1.step();
        world1.step();
        expect(changes).toEqual([
            [create(fooEntity, serializer)],
            [remove(fooEntity.uuid)],
        ]);
    });

    it('reports when an entity is updated', () => {
        world1.entities.set('fooEntity', fooEntity);
        world1.step();
        fooEntity.components.get(FOO_COMPONENT)!.x = 456;
        world1.step();
        world1.step();
        expect(changes).toEqual([
            [create(fooEntity, serializer)],
            [update(fooEntity, serializer)],
        ]);
    });

    it('does not report predictable changes', () => {
        world1.entities.set('fooEntity', fooEntity);
        world1.step();

        recordSystems(() => {
            world1.addSystem(IncrementFoo);
        });
        world1.step();

        expect(changes).toEqual([
            [create(fooEntity, serializer)],
        ]);
    });

    it('does not add systems outside of recordSystems', () => {
        world1.entities.set('fooEntity', fooEntity);
        world1.step();
        world1.addSystem(IncrementFoo);
        world1.step();

        // There is an update here because the change detection system did not
        // detect when foo was incremented (because it does not have the
        // IncrementFoo system).

        // Note that it's okay that create includes a reference to the component
        // (i.e. create(fooEntity...) has x === 124 here instead of 123) because
        // the objective is to share the current state, not make an accurate
        // history of changes.
        expect(changes).toEqual([
            [create(fooEntity, serializer)],
            [update(fooEntity, serializer)],
        ]);
    });

    it('adds changes to ChangesResource', () => {
        world1.entities.set('fooEntity', fooEntity);
        world1.step();

        expect(world1.resources.get(ChangesResource)).toEqual([
            create(fooEntity, serializer)
        ]);
    });

    it('applies changes to another world', () => {
        world1.entities.set('fooEntity', fooEntity);
        world1.step();

        expect(world2.entities.size).toEqual(1); // singleton entity.

        applyChanges(world2, world1.resources.get(ChangesResource)!);
        const foo2 = world2.entities.get('fooEntity');

        expect(world2.entities.size).toEqual(2);
        expect(foo2).toBeDefined();
        expect(foo2?.components.size).toEqual(1);
        expect(foo2?.components.get(FOO_COMPONENT)).toEqual({x: 123});
    });
});
