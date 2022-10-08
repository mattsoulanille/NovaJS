import * as t from "io-ts";
import { Component } from "nova_ecs/component";
import { Entity } from "nova_ecs/entity";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { Change, ChangesEvent, CopyChangeDetector, create, DetectChanges, RecordSystems, remove, update } from "./copy_change_detector";
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
    let world: World;
    let changes: Change[][];
    let fooEntity: Entity;
    let serializer: Serializer;
    let recordSystems: (add: () => void) => void;

    beforeEach(() => {
        world = new World();
        world.addPlugin(SerializerPlugin);
        world.addPlugin(CopyChangeDetector);
        
        serializer = world.resources.get(SerializerResource)!;
        serializer.addComponent(FOO_COMPONENT, t.type({x: t.number}))
        recordSystems = world.resources.get(RecordSystems)!;

        changes = []
        world.events.get(ChangesEvent).subscribe((c) => {
            changes.push(c);
        });

        fooEntity = new Entity('testEntity')
            .addComponent(FOO_COMPONENT, {x: 123});
    });

    it('reports nothing when nothing changes', () => {
        world.step();
        world.step();
        expect(changes).toEqual([]);

    });

    it('reports when an entity is added', () => {
        world.entities.set('fooEntity', fooEntity);
        world.step();
        world.step();
        world.step();
        expect(changes).toEqual([
            [create(fooEntity, serializer)]
        ]);
    });

    it('reports when an entity is removed', () => {
        world.entities.set('fooEntity', fooEntity);
        world.step();
        world.entities.delete('fooEntity');
        world.step();
        world.step();
        expect(changes).toEqual([
            [create(fooEntity, serializer)],
            [remove(fooEntity.uuid)],
        ]);
    });

    it('reports when an entity is updated', () => {
        world.entities.set('fooEntity', fooEntity);
        world.step();
        fooEntity.components.get(FOO_COMPONENT)!.x = 456;
        world.step();
        world.step();
        expect(changes).toEqual([
            [create(fooEntity, serializer)],
            [update(fooEntity, serializer)],
        ]);
    });

    it('does not report predictable changes', () => {
        world.entities.set('fooEntity', fooEntity);
        world.step();

        recordSystems(() => {
            world.addSystem(IncrementFoo);
        });
        world.step();

        expect(changes).toEqual([
            [create(fooEntity, serializer)],
        ]);
    });

});
