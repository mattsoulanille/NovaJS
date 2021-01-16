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

const BAR_COMPONENT = new Component<{
    y: string;
}>({ name: 'bar' });

describe('async system', () => {
    let world: World;
    beforeEach(() => {
        world = new World();
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
        await world.resources.get(AsyncSystemData)?.done;
        world.step();
        expect(world.entities.has(toRemove.uuid)).toBeFalse();
    });
});
