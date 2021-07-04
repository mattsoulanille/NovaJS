import 'jasmine';
import { Component, UnknownComponent } from './component';
import { EntityBuilder } from './entity';
import { AsyncProviderResource, Provide, ProvideAsync } from './provider';
import { System } from './system';
import { World } from './world';


function sleep(ms: number) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

const FOO_COMPONENT = new Component<{ x: number }>('foo');
const BAR_COMPONENT = new Component<{ y: string }>('bar');

describe('provider', () => {
    let clock: jasmine.Clock;

    beforeEach(() => {
        clock = jasmine.clock();
        clock.install();
    });

    afterEach(() => {
        clock.uninstall();
    });

    it('provides a component if the entity is missing it', () => {
        const world = new World();

        const fooProvider = Provide({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            factory: (bar) => {
                return {
                    x: bar.y.length
                }
            }
        });

        const wordLengths: [string, number][] = [];

        const providesFoo = new System({
            name: 'providesFoo',
            args: [BAR_COMPONENT, fooProvider] as const,
            step: (bar, foo) => {
                wordLengths.push([bar.y, foo.x]);
            }
        });

        world.addSystem(providesFoo);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

        world.step();

        expect(wordLengths).toEqual([['hello', 5]]);
    });

    it('returns the existing component if the entity has it', () => {
        const world = new World();

        const fooProvider = Provide({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            factory: (bar) => {
                return {
                    x: bar.y.length
                }
            }
        });

        const wordLengths: [string, number][] = [];

        const providesFoo = new System({
            name: 'providesFoo',
            args: [BAR_COMPONENT, fooProvider] as const,
            step: (bar, foo) => {
                wordLengths.push([bar.y, foo.x]);
            }
        });

        world.addSystem(providesFoo);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

        world.step();

        expect(wordLengths).toEqual([['hello', 123]]);
    });

    it('provides a component asynchronously', async () => {
        const world = new World();

        const fooProvider = ProvideAsync({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            factory: async (bar) => {
                await sleep(10);
                return {
                    x: bar.y.length
                }
            }
        });

        const wordLengths: [string, number][] = [];

        const providesFoo = new System({
            name: 'providesFoo',
            args: [BAR_COMPONENT, fooProvider] as const,
            step: (bar, foo) => {
                wordLengths.push([bar.y, foo.x]);
            }
        });

        world.addSystem(providesFoo);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

        world.step();
        expect(wordLengths).toEqual([]);
        clock.tick(11);
        await world.resources.get(AsyncProviderResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);
    });

    it('async provider can modify args', async () => {
        const world = new World();

        const fooProvider = ProvideAsync({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            factory: async (bar) => {
                await sleep(10);
                bar.y = bar.y + ' there';
                return {
                    x: bar.y.length
                }
            }
        });

        const wordLengths: [string, number][] = [];

        const providesFoo = new System({
            name: 'providesFoo',
            args: [BAR_COMPONENT, fooProvider] as const,
            step: (bar, foo) => {
                wordLengths.push([bar.y, foo.x]);
            }
        });

        world.addSystem(providesFoo);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

        world.step();
        expect(wordLengths).toEqual([]);
        clock.tick(11);
        await world.resources.get(AsyncProviderResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello there', 11]]);
    });

    it('deletes entries in provider map when the entity is removed', () => {
        const world = new World();

        const fooProvider = ProvideAsync({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            factory: async (bar) => {
                await sleep(10);
                return {
                    x: bar.y.length
                }
            }
        });

        const wordLengths: [string, number][] = [];
        const providesFoo = new System({
            name: 'providesFoo',
            args: [BAR_COMPONENT, fooProvider] as const,
            step: (bar, foo) => {
                wordLengths.push([bar.y, foo.x]);
            }
        });

        world.addSystem(providesFoo);

        expect(world.resources.get(AsyncProviderResource)?.providers.size).toBe(0);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());
        world.step();
        expect(world.resources.get(AsyncProviderResource)?.providers.size).toBe(1);

        world.entities.delete('word1');
        world.step();
        expect(world.resources.get(AsyncProviderResource)?.providers.size).toBe(0);
    });
});
