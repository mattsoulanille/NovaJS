import 'jasmine';
import { Component, UnknownComponent } from './component';
import { EntityBuilder } from './entity';
import { EventMap } from './event_map';
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

describe('Provide', () => {
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

    it('runs the factory only once', () => {
        const world = new World();

        const factorySpy = jasmine.createSpy('factory', (bar) => {
            return {
                x: bar.y.length,
            }
        }).and.callThrough();

        const fooProvider = Provide({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            factory: factorySpy,
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
        world.step();
        world.step();
        world.step();

        expect(wordLengths).toEqual([
            ['hello', 5],
            ['hello', 5],
            ['hello', 5],
            ['hello', 5],
        ]);
        expect(factorySpy).toHaveBeenCalledTimes(1);
    });

    it('recreates the provided component when inputs change', () => {
        const world = new World();

        const fooProvider = Provide({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            update: [BAR_COMPONENT],
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
        const word1 = new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build();

        world.entities.set('word1', word1);
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        word1.components.set(BAR_COMPONENT, { y: 'bye' });
        world.step();
        expect(wordLengths).toEqual([['hello', 5], ['bye', 3]]);
    });

    it('does not recreate the value if not tracking changed input', () => {
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
        const word1 = new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build();

        world.entities.set('word1', word1);
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        word1.components.set(BAR_COMPONENT, { y: 'bye' });
        world.step();

        // Note 'bye' still has 5 associated with it instead of 3.
        expect(wordLengths).toEqual([['hello', 5], ['bye', 5]]);
    });

    it('ignores silent changes to components', () => {
        const world = new World();

        const fooProvider = Provide({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            update: [BAR_COMPONENT],
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
        const word1 = new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build();

        world.entities.set('word1', word1);
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        (word1.components as EventMap<Component<any>, unknown>)
            .set(BAR_COMPONENT, { y: 'bye' }, true /* Silent */);

        world.step();
        // Ignores the change and just returns the current value
        expect(wordLengths).toEqual([['hello', 5], ['hello', 5]]);
    });
});

describe('ProvideAsync', () => {
    let clock: jasmine.Clock;

    beforeEach(() => {
        clock = jasmine.clock();
        clock.install();
    });

    afterEach(() => {
        clock.uninstall();
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

    it('recreates the provided component when inputs change', async () => {
        const world = new World();

        const fooProvider = ProvideAsync({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            update: [BAR_COMPONENT],
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
        const word1 = new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build();

        world.entities.set('word1', word1);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncProviderResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        word1.components.set(BAR_COMPONENT, { y: 'bye' });
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncProviderResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5], ['bye', 3]]);
    });

    it('ignores a provided value if it is out of date', async () => {
        const world = new World();

        let sleepTime = 20;
        let foosProvided: number[] = [];
        const fooProvider = ProvideAsync({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            update: [BAR_COMPONENT],
            factory: async (bar) => {
                await sleep(sleepTime);
                foosProvided.push(bar.y.length);
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
        const word1 = new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build();

        world.entities.set('word1', word1);
        world.step();
        clock.tick(21);
        await world.resources.get(AsyncProviderResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        // 'bye' will finish after 'bye again', but the value of bar should be
        // based on 'bye again', i.e. 9.
        // sleepTime == 20 right now.
        word1.components.set(BAR_COMPONENT, { y: 'bye' });
        world.step();
        sleepTime = 10;
        word1.components.set(BAR_COMPONENT, { y: 'bye again' });
        world.step();

        clock.tick(40);
        await world.resources.get(AsyncProviderResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5], ['bye again', 9]]);
        // 'hello' finishes first, then 'bye again', then 'bye'.
        expect(foosProvided).toEqual([5, 9, 3]);
    });

    it('ignores when components are changed silently', async () => {
        const world = new World();

        const fooProvider = ProvideAsync({
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            update: [BAR_COMPONENT],
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
        const word1 = new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build();

        world.entities.set('word1', word1);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncProviderResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        (word1.components as EventMap<Component<any>, unknown>)
            .set(BAR_COMPONENT, { y: 'bye' }, true /* Silent */);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncProviderResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5], ['hello', 5], ['hello', 5]]);
    });
});
