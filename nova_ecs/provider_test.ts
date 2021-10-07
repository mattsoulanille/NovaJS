import 'jasmine';
import { AsyncSystemResource } from './async_system';
import { Component } from './component';
import { EntityBuilder } from './entity';
import { EventMap } from './event_map';
import { Provide, ProvideAsync } from './provider';
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
    let world: World;
    let wordLengths: [string, number][];
    const fooProvider = Provide({
        name: 'foo from bar',
        provided: FOO_COMPONENT,
        args: [BAR_COMPONENT] as const,
        factory: (bar) => {
            return {
                x: bar.y.length
            }
        }
    });

    const logSystem = new System({
        name: 'logSystem',
        args: [BAR_COMPONENT, FOO_COMPONENT] as const,
        step: (bar, foo) => {
            wordLengths.push([bar.y, foo.x]);
        }
    });

    beforeEach(() => {
        world = new World();
        wordLengths = [];
    });


    it('provides a component if the entity is missing it', () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

        world.step();

        expect(wordLengths).toEqual([['hello', 5]]);
    });

    it('returns the existing component if the entity has it', () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

        world.step();

        expect(wordLengths).toEqual([['hello', 123]]);
    });

    it('runs the factory only once', () => {
        const factorySpy = jasmine.createSpy('factory', (bar) => {
            return {
                x: bar.y.length,
            }
        }).and.callThrough();

        const fooProvider = Provide({
            name: 'foo from bar',
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            factory: factorySpy,
        });

        world.addSystem(fooProvider);
        world.addSystem(logSystem);

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
        const fooProvider = Provide({
            name: 'foo from bar',
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            update: [BAR_COMPONENT],
            factory: (bar) => {
                return {
                    x: bar.y.length
                }
            }
        });

        world.addSystem(fooProvider);
        world.addSystem(logSystem);

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
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

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
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

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

    it('provides a component once the entity has the input component', () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        const word1 = new EntityBuilder().build();

        world.entities.set('word1', word1);
        world.step();
        world.step();
        world.step();
        expect(wordLengths).toEqual([]);

        word1.components.set(BAR_COMPONENT, { y: 'hello' });
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);
    });
});

describe('ProvideAsync', () => {
    let clock: jasmine.Clock;
    let world: World;
    let wordLengths: [string, number][];

    const fooProvider = ProvideAsync({
        name: 'foo from bar',
        provided: FOO_COMPONENT,
        args: [BAR_COMPONENT] as const,
        factory: async (bar) => {
            await sleep(10);
            return {
                x: bar.y.length
            }
        }
    });

    const logSystem = new System({
        name: 'logSystem',
        args: [BAR_COMPONENT, FOO_COMPONENT] as const,
        step: (bar, foo) => {
            wordLengths.push([bar.y, foo.x]);
        }
    });

    beforeEach(() => {
        clock = jasmine.clock();
        clock.install();

        world = new World();
        wordLengths = [];
    });

    afterEach(() => {
        clock.uninstall();
    });

    it('provides a component asynchronously', async () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

        world.step();
        expect(wordLengths).toEqual([]);
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);
    });

    it('returns the existing component if the entity has it', async () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(wordLengths).toEqual([['hello', 123], ['hello', 123]]);
    });

    it('async provider can modify args', async () => {
        const fooProvider = ProvideAsync({
            name: 'foo from bar',
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

        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        world.entities.set('word1', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

        world.step();
        expect(wordLengths).toEqual([]);
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello there', 11]]);
    });

    it('recreates the provided component when inputs change', async () => {
        const fooProvider = ProvideAsync({
            name: 'foo from bar',
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

        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        const word1 = new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build();

        world.entities.set('word1', word1);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        word1.components.set(BAR_COMPONENT, { y: 'bye' });
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5], ['bye', 5], ['bye', 3]]);
    });

    it('ignores a provided value if it is out of date', async () => {
        let sleepTime = 20;
        const foosProvided: number[] = [];
        const fooProvider = ProvideAsync({
            name: 'foo from bar',
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

        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        const word1 = new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build();

        world.entities.set('word1', word1);
        world.step();
        clock.tick(21);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        // 'bye' will finish after 'bye again', but the value of bar should be
        // based on 'bye again', i.e. 9.
        sleepTime = 20;
        word1.components.set(BAR_COMPONENT, { y: 'bye' });
        world.step();
        sleepTime = 10;
        word1.components.set(BAR_COMPONENT, { y: 'bye again' });
        world.step();

        clock.tick(10);
        clock.tick(30);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([
            ['hello', 5],
            ['bye', 5],
            ['bye again', 5],
            ['bye again', 9]
        ]);
        // Note that ['bye', 3] is not in the list even though its provider
        // finished after 'bye again' 's provider.

        // 'hello' finishes first, then 'bye again', then 'bye'.
        expect(foosProvided).toEqual([5, 9, 3]);
    });

    it('ignores when components are changed silently', async () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        const word1 = new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' }).build();

        world.entities.set('word1', word1);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        (word1.components as EventMap<Component<any>, unknown>)
            .set(BAR_COMPONENT, { y: 'bye' }, true /* Silent */);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5], ['hello', 5], ['hello', 5]]);
    });
});
