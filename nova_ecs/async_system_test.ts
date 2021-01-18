import 'jasmine';
import { Commands, UUID } from './arg_types';
import { AsyncSystem, AsyncSystemData } from './async_system';
import { Component } from './component';
import { Entity } from './entity';
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

        const handle = world.addEntity(new Entity()
            .addComponent(BAR_COMPONENT, { y: 'not changed' }));

        world.addSystem(asyncSystem);
        world.step();
        clock.tick(1);
        await world.resources.get(AsyncSystemData)?.done;
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
            args: [UUID, Commands, BAR_COMPONENT] as const,
            step: (uuid, commands) => {
                commands.removeEntity(uuid);
            },
            after: [asyncSystem],
        });

        const toRemove = world.addEntity(new Entity()
            .addComponent(BAR_COMPONENT, { y: 'not changed' }));

        world.addSystem(asyncSystem);
        world.addSystem(removeBarSystem);
        world.step();
        clock.tick(1);
        await world.resources.get(AsyncSystemData)?.done;
        world.step();
        expect(world.entities.has(toRemove.uuid)).toBeFalse();
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
        world.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 0 }));

        world.step();
        world.step();
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemData)?.done;
        world.step();
        world.step();
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemData)?.done;

        expect(fooValues).toEqual([1, 1, 1, 2, 2, 2]);
    });

    // it('passes an async version of commands', async () => {
    //     const addEntitySystem = new AsyncSystem({
    //         name: 'AddEntity',
    //         args: [Commands, BAR_COMPONENT] as const,
    //         step: async (commands) => {
    //             await sleep(10);
    //             commands.addEntity(new Entity()
    //                 .addComponent(FOO_COMPONENT, { x: 123 }));
    //         }
    //     });

    //     world.addEntity(new Entity()
    //         .addComponent(BAR_COMPONENT, { y: 'bar' })
    //     );

    //     world.addSystem(addEntitySystem);

    //     world.step();
    //     clock.tick(11);
    //     await world.resources.get(AsyncSystemData)?.done;
    // });
});
