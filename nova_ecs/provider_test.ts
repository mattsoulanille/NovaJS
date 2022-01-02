import { createDraft, finishDraft } from 'immer';
import 'jasmine';
import { Defaults } from 'novadatainterface/Defaults';
import { PlanetData } from 'novadatainterface/PlanetData';
import { AsyncSystemResource } from './async_system';
import { Component } from './component';
import { Entity } from './entity';
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

        world.entities.set('word1', new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' }));

        world.step();

        expect(wordLengths).toEqual([['hello', 5]]);
    });

    it('returns the existing component if the entity has it', () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        world.entities.set('word1', new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'hello' }));

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

        world.entities.set('word1', new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' }));

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

        const word1 = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });

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

        const word1 = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });

        world.entities.set('word1', word1);
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        word1.components.set(BAR_COMPONENT, { y: 'bye' });
        world.step();

        // Note 'bye' still has 5 associated with it instead of 3.
        expect(wordLengths).toEqual([['hello', 5], ['bye', 5]]);
    });

    it('ignores silent changes to components', () => {
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

        const word1 = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });

        world.entities.set('word1', word1);
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        word1.components.set(BAR_COMPONENT, { y: 'asdf' });
        world.step();

        (word1.components as EventMap<Component<any>, unknown>)
            .set(BAR_COMPONENT, { y: 'bye' }, true /* Silent */);
        world.step();

        // Ignores the change to 'bye' and just returns the current value
        expect(wordLengths).toEqual([['hello', 5], ['asdf', 4], ['bye', 4]]);
    });

    it('provides a component once the entity has the input component', () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        const word1 = new Entity();

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

        world.entities.set('word1', new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' }));

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

        world.entities.set('word1', new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'hello' }));

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

        world.entities.set('word1', new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' }));

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

        const word1 = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });

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

        const word1 = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });

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

        const word1 = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });

        world.entities.set('word1', word1);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5]]);

        word1.components.set(BAR_COMPONENT, { y: 'asdf' });
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([['hello', 5], ['asdf', 5], ['asdf', 4]]);

        (word1.components as EventMap<Component<any>, unknown>)
            .set(BAR_COMPONENT, { y: 'bye' }, true /* Silent */);
        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        expect(wordLengths).toEqual([
            ['hello', 5],
            ['asdf', 5], ['asdf', 4], // Changes to 4
            ['bye', 4], ['bye', 4], // Does not change to 3
        ]);
    });

    it('can return an argument as the provided value', async () => {
        const OtherFoo = new Component<{ x: number }>('other foo');
        const fooProvider = ProvideAsync({
            name: 'foo from otherFoo',
            provided: FOO_COMPONENT,
            args: [OtherFoo],
            async factory(otherFoo) {
                await sleep(10);
                return otherFoo;
            }
        });

        world.addSystem(fooProvider);

        const testEntity = new Entity()
            .addComponent(OtherFoo, { x: 123 });
        world.entities.set('testEntity', testEntity);

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(testEntity.components.get(FOO_COMPONENT))
            .toEqual({ x: 123 });
    });

    it('works with larger objects', async () => {
        const PlanetDataComponent = new Component<PlanetData>('PlanetData');
        const PlanetDataProvider = ProvideAsync({
            name: 'PlanetDataProvider',
            provided: PlanetDataComponent,
            args: [BAR_COMPONENT] as const,
            async factory(_bar) {
                await sleep(10);
                return Defaults.Planet;
            }
        });

        world.addSystem(PlanetDataProvider);

        const testEntity = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });
        world.entities.set('testEntity', testEntity);

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(testEntity.components.get(PlanetDataComponent))
            .toEqual(Defaults.Planet);
    });

    it('can provide data that is already drafted', async () => {
        const OtherFoo = new Component<{ x: number }>('other foo');
        const fooProvider = ProvideAsync({
            name: 'foo from otherFoo',
            provided: FOO_COMPONENT,
            args: [OtherFoo],
            async factory(otherFoo) {
                await sleep(10);
                return { ...otherFoo };
            }
        });

        world.addSystem(fooProvider);

        let otherFooData = { x: 123 };
        const draftFoo = createDraft(otherFooData);

        const testEntity = new Entity()
            .addComponent(OtherFoo, draftFoo);
        world.entities.set('testEntity', testEntity);

        world.step();
        finishDraft(draftFoo);
        testEntity.components.set(OtherFoo, { x: 456 });
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;

        world.step();

        const resultFoo = testEntity.components.get(FOO_COMPONENT);
        expect(resultFoo).toEqual({ x: 123 });
    });

    it('tries again if an entity is removed before complete and reinserted', async () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        let entity = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });
        world.entities.set('word1', entity);

        world.step();
        world.entities.delete('word1');
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        world.entities.set('word1', entity);

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(entity.components.get(FOO_COMPONENT)?.x).toEqual(5);
    });

    it('tries again if the factory throws an error', async () => {
        let willThrow = true;
        const onErrorSpy = jasmine.createSpy('onErrorSpy');
        const fooProvider = ProvideAsync({
            name: 'foo from bar',
            provided: FOO_COMPONENT,
            args: [BAR_COMPONENT] as const,
            update: [BAR_COMPONENT],
            onError: onErrorSpy,
            factory: (bar) => {
                if (willThrow) {
                    throw new Error('Provider throwing error');
                }
                return {
                    x: bar.y.length
                }
            }
        });

        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        const entity = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });
        world.entities.set('word1', entity);

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(wordLengths).toEqual([]);
        expect(entity.components.has(FOO_COMPONENT)).toBeFalse();
        expect(onErrorSpy).toHaveBeenCalled();

        willThrow = false;

        world.step();
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();

        expect(wordLengths).toEqual([['hello', 5]]);
        expect(entity.components.get(FOO_COMPONENT)).toEqual({ x: 5 });
    });

    it('does not provide if the provided value is changed while the provider is running', async () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        const entity = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });
        world.entities.set('word1', entity);

        world.step();
        expect(wordLengths).toEqual([]);
        entity.components.set(FOO_COMPONENT, { x: 123 });
        clock.tick(11);
        await world.resources.get(AsyncSystemResource)?.done;
        world.step();
        // Not ['hello', 5] since 123 was provided while the provider was running.
        expect(wordLengths).toEqual([['hello', 123]]);
        expect(entity.components.get(FOO_COMPONENT)?.x).toEqual(123);
    });
});
