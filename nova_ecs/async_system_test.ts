import 'jasmine';
import { v4 } from 'uuid';
import { Entities, UUID } from './arg_types';
import { AsyncSystem, AsyncSystemResource } from './async_system';
import { Component, ComponentData } from './component';
import { Angle } from './datatypes/angle';
import { Vector } from './datatypes/vector';
import { EntityBuilder } from './entity';
import { Query } from './query';
import { System } from './system';
import { World } from './world';


async function sleep(ms: number) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

const FOO_COMPONENT = new Component<{
    x: number;
}>({ name: 'foo' })

const BAR_COMPONENT = new Component<{
    y: string;
}>({ name: 'bar' });

const MovementComponent = new Component<{
    position: Vector,
    velocity: Vector,
    rotation: Angle,
}>({ name: 'movement' });

describe('async system', () => {
    let world: World;
    let clock: jasmine.Clock;

    beforeEach(() => {
        world = new World();
        clock = jasmine.clock();
        clock.install();
    });

    afterEach(() => {
        clock.uninstall();
    });

    it('supports async systems', async () => {
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [BAR_COMPONENT],
            step: async (bar) => {
                await sleep(0);
                bar.y = 'changed bar asynchronously';
            }
        });

        const uuid = v4();
        world.entities.set(uuid, new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'not changed' }));
        const handle = world.entities.get(uuid)!;

        world.addSystem(asyncSystem);
        world.step();
        clock.tick(1);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(handle.components.get(BAR_COMPONENT)?.y)
            .toEqual('changed bar asynchronously');
    });

    it('does not throw an error if the async system\'s entity is deleted', async () => {
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [BAR_COMPONENT],
            step: async (bar) => {
                await sleep(0);
                bar.y = 'changed bar asynchronously';
            }
        });

        const removeBarSystem = new System({
            name: 'RemoveBar',
            args: [UUID, Entities, BAR_COMPONENT] as const,
            step: (uuid, entities) => {
                entities.delete(uuid);
            },
            after: [asyncSystem],
        });

        const uuid = v4();
        world.entities.set(uuid, new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'not changed' }));

        world.addSystem(asyncSystem);
        world.addSystem(removeBarSystem);
        world.step();
        clock.tick(1);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(world.entities.has(uuid)).toBeFalse();
    });

    it('may run multiple instances at a time', async () => {
        const fooValues: number[] = [];
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [FOO_COMPONENT],
            step: async (foo) => {
                await sleep(10);
                foo.x += 1;
                fooValues.push(foo.x);
            }
        });

        world.addSystem(asyncSystem);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 0 }));

        world.step();
        world.step();
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        world.step();
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;

        expect(fooValues).toEqual([1, 1, 1, 2, 2, 2]);
    });

    it('passes an async version of entities', async () => {
        const addEntitySystem = new AsyncSystem({
            name: 'AddEntity',
            args: [Entities, UUID, BAR_COMPONENT] as const,
            step: async (entities, uuid) => {
                await sleep(10);
                entities.set('test uuid', new EntityBuilder()
                    .addComponent(FOO_COMPONENT, { x: 123 }).build());
                entities.delete(uuid);
            }
        });

        world.entities.set('remove me', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'bar' })
            .build()
        );

        world.addSystem(addEntitySystem);

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(world.entities.get('test uuid')?.components
            .get(FOO_COMPONENT)?.x).toEqual(123);
        expect(world.entities.get('remove me')).toBeUndefined();
    });

    it('works with complex immerables', async () => {
        const expectedMovementComponent: ComponentData<typeof MovementComponent> = {
            position: new Vector(4, 5),
            velocity: new Vector(1, 2),
            rotation: new Angle(3),
        };
        const movable = new EntityBuilder()
            .addComponent(MovementComponent, expectedMovementComponent);

        const addedMovement = new Component<{
            added: boolean
        }>({ name: 'added' });

        const addMovableSystem = new AsyncSystem({
            name: 'addMovable',
            args: [addedMovement, Entities] as const,
            step: async (addedMovement, entities) => {
                await sleep(10);
                if (!addedMovement.added) {
                    entities.set('movable', movable);
                    addedMovement.added = true;
                }
            }
        });

        world.addSystem(addMovableSystem);
        world.singletonEntity.components.set(addedMovement, { added: false });
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(world.entities.get('movable')?.components.get(MovementComponent))
            .toEqual(expectedMovementComponent);
    });

    it('works with other synchronous systems', async () => {
        const fooValues: number[] = [];
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [FOO_COMPONENT],
            step: async (foo) => {
                await sleep(10);
                foo.x = 0;
            }
        });

        const syncSystem = new System({
            name: 'SyncSystem',
            args: [FOO_COMPONENT],
            step: (foo) => {
                foo.x++;
                fooValues.push(foo.x);
            }
        });

        world.addSystem(asyncSystem);
        world.addSystem(syncSystem);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 0 }));

        world.step();
        world.step();
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        world.step();
        world.step();
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;

        expect(fooValues).toEqual([1, 2, 3, 1, 2, 3, 4]);
    });

    it('can read queries', async () => {
        const fooValues: number[] = [];
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [new Query([FOO_COMPONENT]), FOO_COMPONENT] as const,
            step: async (fooQuery) => {
                await sleep(10);
                for (const query of fooQuery) {
                    fooValues.push(query[0].x);
                }
            }
        });

        world.addSystem(asyncSystem);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 }))
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 456 }))

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(fooValues).toEqual([123, 456, 123, 456]);
    });

    it('can write queries', async () => {
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [new Query([FOO_COMPONENT]), FOO_COMPONENT] as const,
            step: async (fooQuery) => {
                await sleep(10);
                for (const query of fooQuery) {
                    query[0].x += 1;
                }
            }
        });

        world.addSystem(asyncSystem);
        world.entities.set('firstEntity', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 }))
        world.entities.set('secondEntity', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 456 }))

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        // With a synchronous system, we'd expect each foo compoent to be incremented
        // twice, once by 'firstEntity' and another time by 'secondEntity'.
        // However, since the system runs asynchronously on both, it gets the same
        // starting value for both, so it writes them as 124, 457 twice.
        expect(world.entities.get('firstEntity')?.components.get(FOO_COMPONENT)?.x)
            .toEqual(124);
        expect(world.entities.get('secondEntity')?.components.get(FOO_COMPONENT)?.x)
            .toEqual(457);
    });
});
