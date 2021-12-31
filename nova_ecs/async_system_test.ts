import { createDraft, finishDraft } from 'immer';
import 'jasmine';
import { v4 } from 'uuid';
import { Entities, UUID } from './arg_types';
import { AsyncSystem, AsyncSystemResource } from './async_system';
import { Component, ComponentData } from './component';
import { Angle } from './datatypes/angle';
import { Vector } from './datatypes/vector';
import { Entity } from './entity';
import { EcsEvent, StepEvent } from './events';
import { Optional } from './optional';
import { Query } from './query';
import { System } from './system';
import { World } from './world';


async function sleep(ms: number) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

const FOO_COMPONENT = new Component<{ x: number }>('foo');

const BAR_COMPONENT = new Component<{ y: string }>('bar');

const MovementComponent = new Component<{
    position: Vector,
    velocity: Vector,
    rotation: Angle,
}>('movement');

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
        world.entities.set(uuid, new Entity()
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
        world.entities.set(uuid, new Entity()
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
        world.entities.set(v4(), new Entity()
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

    it('exclusive systems run one at a time', async () => {
        // Exclusive systems run only one async call
        // at a time per each entity.
        const fooValues: number[] = [];
        const largeFooValues: number[] = [];
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [FOO_COMPONENT],
            exclusive: true,
            step: async (foo) => {
                await sleep(10);
                foo.x += 1;
                if (foo.x > 100) {
                    largeFooValues.push(foo.x);
                } else {
                    fooValues.push(foo.x);
                }
            }
        });

        world.addSystem(asyncSystem);
        world.entities.set('small foo', new Entity()
            .addComponent(FOO_COMPONENT, { x: 0 }));
        world.entities.set('large foo', new Entity()
            .addComponent(FOO_COMPONENT, { x: 1000 }));

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

        expect(fooValues).toEqual([1, 2]);
        expect(largeFooValues).toEqual([1001, 1002]);
    });

    it('does not run if applying patches', async () => {
        // Systems that skip when there are patches to apply
        // do not run if there are patches from a previous run
        // that need to be applied.
        const fooValues: number[] = [];
        const largeFooValues: number[] = [];
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [FOO_COMPONENT],
            skipIfApplyingPatches: true,
            step: async (foo) => {
                await sleep(10);
                foo.x += 1;
                if (foo.x > 100) {
                    largeFooValues.push(foo.x);
                } else {
                    fooValues.push(foo.x);
                }
            }
        });

        world.addSystem(asyncSystem);
        world.entities.set('small foo', new Entity()
            .addComponent(FOO_COMPONENT, { x: 0 }));
        world.entities.set('large foo', new Entity()
            .addComponent(FOO_COMPONENT, { x: 1000 }));

        world.step();
        world.step();
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        // First one only applies patches. The rest still run.
        world.step();
        world.step();
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;

        expect(fooValues).toEqual([1, 1, 1, 2, 2]);
        expect(largeFooValues).toEqual([1001, 1001, 1001, 1002, 1002]);
    });

    it('always runs on events even if exclusive', async () => {
        const fooValues: number[] = [];
        const largeFooValues: number[] = [];
        const AddEvent = new EcsEvent<number>('AddEvent');
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            exclusive: true,
            events: [StepEvent, AddEvent],
            args: [FOO_COMPONENT, Optional(AddEvent)] as const,
            step: async (foo, add) => {
                await sleep(10);
                foo.x += add ?? 1;
                if (foo.x > 100) {
                    largeFooValues.push(foo.x);
                } else {
                    fooValues.push(foo.x);
                }
            }
        });

        world.addSystem(asyncSystem);
        world.entities.set('small foo', new Entity()
            .addComponent(FOO_COMPONENT, { x: 0 }));
        world.entities.set('large foo', new Entity()
            .addComponent(FOO_COMPONENT, { x: 1000 }));

        world.step();
        world.step();
        world.emit(AddEvent, 10);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        world.step();
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;

        expect(fooValues).toEqual([1, 10, 11]);
        expect(largeFooValues).toEqual([1001, 1010, 1011]);
    });

    it('always runs on events even if it skips when applying patches', async () => {
        const fooValues: number[] = [];
        const largeFooValues: number[] = [];
        const AddEvent = new EcsEvent<number>('AddEvent');
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            skipIfApplyingPatches: true,
            events: [AddEvent],
            args: [FOO_COMPONENT, AddEvent] as const,
            step: async (foo, add) => {
                await sleep(10);
                foo.x += add;
                if (foo.x > 100) {
                    largeFooValues.push(foo.x);
                } else {
                    fooValues.push(foo.x);
                }
            }
        });

        world.addSystem(asyncSystem);
        world.entities.set('small foo', new Entity()
            .addComponent(FOO_COMPONENT, { x: 0 }));
        world.entities.set('large foo', new Entity()
            .addComponent(FOO_COMPONENT, { x: 1000 }));

        world.emit(AddEvent, 1);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.emit(AddEvent, 4);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.emit(AddEvent, 7);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(fooValues).toEqual([1, 5, 12]);
        expect(largeFooValues).toEqual([1001, 1005, 1012]);
    });

    it('exclusive systems that also skip their run when applying patches' +
        ' can still run after applying patches', async () => {
            const fooValues: number[] = [];
            const asyncSystem = new AsyncSystem({
                name: 'AsyncSystem',
                skipIfApplyingPatches: true,
                exclusive: true,
                args: [FOO_COMPONENT] as const,
                step: async (foo) => {
                    await sleep(10);
                    foo.x++;
                    fooValues.push(foo.x);
                }
            });

            world.addSystem(asyncSystem);
            world.entities.set('FooEntity', new Entity()
                .addComponent(FOO_COMPONENT, { x: 0 }));

            for (let i = 0; i < 4; i++) {
                world.step();
                clock.tick(11);
                await world.resources.get(AsyncSystemResource)?.done;
                world.step();
            }

            expect(fooValues).toEqual([1, 2, 3, 4]);
        });

    it('passes an async version of entities', async () => {
        const addEntitySystem = new AsyncSystem({
            name: 'AddEntity',
            args: [Entities, UUID, BAR_COMPONENT] as const,
            step: async (entities, uuid) => {
                await sleep(10);
                entities.set('test uuid', new Entity()
                    .addComponent(FOO_COMPONENT, { x: 123 }));
                entities.delete(uuid);
            }
        });

        world.entities.set('remove me', new Entity()
            .addComponent(BAR_COMPONENT, { y: 'bar' }));

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
        const movable = new Entity()
            .addComponent(MovementComponent, expectedMovementComponent);

        const addedMovement = new Component<{ added: boolean }>('added');

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
        world.entities.set(v4(), new Entity()
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
        world.entities.set(v4(), new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 }))
        world.entities.set(v4(), new Entity()
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
        world.entities.set('firstEntity', new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 }))
        world.entities.set('secondEntity', new Entity()
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

    it('returning false cancels applying patches', async () => {
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [BAR_COMPONENT],
            step: async (bar) => {
                await sleep(0);
                bar.y = 'changed bar asynchronously';
                return false;
            }
        });

        const uuid = v4();
        world.entities.set(uuid, new Entity()
            .addComponent(BAR_COMPONENT, { y: 'not changed' }));
        const handle = world.entities.get(uuid)!;

        world.addSystem(asyncSystem);
        world.step();
        clock.tick(1);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(handle.components.get(BAR_COMPONENT)?.y)
            .toEqual('not changed');
    });
    it('can run from an event', async () => {
        const event = new EcsEvent<string>('TestEvent');
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            events: [StepEvent, event],
            args: [BAR_COMPONENT, Optional(event)] as const,
            step: async (bar, newVal) => {
                if (!newVal) {
                    return;
                }
                await sleep(10);
                bar.y = newVal;
            }
        });

        const entity = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'not changed' });
        world.entities.set('test entity', entity);

        world.addSystem(asyncSystem);

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        world.emit(event, 'changed bar');

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(entity.components.get(BAR_COMPONENT)?.y)
            .toEqual('changed bar');
    });

    it('can use a draft that is later revoked as an arg', async () => {
        const foos: number[] = [];
        const logSystem = new AsyncSystem({
            name: 'LogSystem',
            args: [FOO_COMPONENT],
            async step(foo) {
                await sleep(10);
                foos.push(foo.x);
            }
        });

        world.addSystem(logSystem);

        const foo = { x: 123 };
        const draftFoo = createDraft(foo);
        const entity = new Entity()
            .addComponent(FOO_COMPONENT, draftFoo);

        world.entities.set('testEntity', entity);

        world.step();
        finishDraft(draftFoo);
        entity.components.set(FOO_COMPONENT, { x: 456 });
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(foos).toEqual([123]);
    });

    it('works with classes that can not be drafted', async () => {
        class TestClass {
            constructor(public x: number) { }
            foo() {
                return this.x;
            }
        }

        const TestClassComponent = new Component<TestClass>('TestClassComponent');

        const nums: number[] = [];
        const logSystem = new AsyncSystem({
            name: 'LogSystem',
            args: [TestClassComponent],
            async step(testClass) {
                await sleep(10);
                nums.push(testClass.foo());
            }
        });

        world.addSystem(logSystem);

        const testData = new TestClass(123);
        const entity = new Entity()
            .addComponent(TestClassComponent, testData);

        world.entities.set('testEntity', entity);

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(nums).toEqual([123]);
    });

    it('deletes an entity\'s async system data when it is removed', async () => {
        const asyncSystem = new AsyncSystem({
            name: 'AsyncSystem',
            args: [FOO_COMPONENT],
            step: async (foo) => {
                await sleep(10);
                foo.x++;
            }
        });

        let entity = new Entity()
            .addComponent(FOO_COMPONENT, { x: 0 });
        world.entities.set('test entity', entity);

        world.addSystem(asyncSystem);

        world.step();
        world.entities.delete('test entity');
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        world.entities.set('test entity', entity);

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        // If the async system data is not cleaned up, it will
        // run twice and x will be 2.
        expect(entity.components.get(FOO_COMPONENT)?.x)
            .toEqual(1);
    });
});
