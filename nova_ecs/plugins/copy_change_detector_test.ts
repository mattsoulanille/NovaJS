import { isLeft } from "fp-ts/lib/Either";
import * as t from "io-ts";
import { Component } from "nova_ecs/component";
import { Entity } from "nova_ecs/entity";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { applyChanges, Change, ChangesEvent, ChangesResource, CopyChangeDetector, create, DetectChanges, RecordSystems, remove, update } from "./copy_change_detector";
import { DeltaMaker, DeltaResource } from "./delta_plugin";
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
    let deltaMaker: DeltaMaker;
    let recordSystems: (add: () => void) => void;

    function sendEntity(entity: Entity): Entity {
        const encoded = structuredClone(serializer.encode(entity)) as unknown;
        const decoded = serializer.decode(encoded);
        if (isLeft(decoded)) {
            throw new Error(decoded.left.join(', '));
        }
        return decoded.right;
    }

    beforeEach(() => {
        world1 = new World('world1');
        world2 = new World('world2');

        for (const world of [world1, world2]) {
            world.addPlugin(CopyChangeDetector);
        
            serializer = world.resources.get(SerializerResource)!;

            deltaMaker = world.resources.get(DeltaResource)!;

            deltaMaker.addComponent(FOO_COMPONENT, {
                componentType: t.type({x: t.number}),
            });

            deltaMaker.addComponent(BAR_COMPONENT, {
                componentType: t.type({y: t.string}),
            });
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
        const before = sendEntity(fooEntity);
        fooEntity.components.get(FOO_COMPONENT)!.x = 456;
        world1.step();
        world1.step();
        expect(changes).toEqual([
            [create(fooEntity, serializer)],
            [update(before, fooEntity, deltaMaker)!],
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
        const before = sendEntity(fooEntity);
        world1.addSystem(IncrementFoo);
        world1.step();

        expect(changes).toEqual([
            [create(fooEntity, serializer)],
            [update(before, fooEntity, deltaMaker)!],
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

    it('does not leak references to the clone world', () => {
        const barSystem = new System({
            name: 'BarSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = bar.y + ' stepped';
            },
        });
        world1.addSystem(barSystem);

        const barEntity = new Entity()
            .addComponent(BAR_COMPONENT, {
                y: 'a test component',
            });
        world1.entities.set('test uuid', barEntity);

        world1.step();
        expect(world1.resources.get(ChangesResource)).toEqual([
            create(new Entity(undefined, undefined, 'test uuid')
                .addComponent(BAR_COMPONENT, {
                    y: 'a test component stepped'
                }), serializer),
        ]);
     
        world1.step();
        expect(world1.resources.get(ChangesResource)).toEqual([
            update(
                new Entity(undefined, undefined, 'test uuid')
                    .addComponent(BAR_COMPONENT, {
                        y: 'a test component stepped'
                    }),
                new Entity(undefined, undefined, 'test uuid')
                    .addComponent(BAR_COMPONENT, {
                        y: 'a test component stepped stepped'
                    }),
                deltaMaker)!,
        ]);

        world1.step();
        expect(world1.resources.get(ChangesResource)).toEqual([
            update(
                new Entity(undefined, undefined, 'test uuid')
                    .addComponent(BAR_COMPONENT, {
                        y: 'a test component stepped stepped'
                    }),
                new Entity(undefined, undefined, 'test uuid')
                    .addComponent(BAR_COMPONENT, {
                        y: 'a test component stepped stepped stepped'
                    }),
                deltaMaker)!,
        ]);
    });
});
