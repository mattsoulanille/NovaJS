import 'jasmine';
import { accessSetOf } from './ambiguities.js';
import { SetComponent } from './arg_types.js';
import { Component } from './component.js';
import { Entity } from './entity.js';
import { EventMap } from './event_map.js';
import { Provide } from './provide.js';
import { System } from './system.js';
import { World } from './world.js';


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

    it('declares its provided component and its factory inputs, not the whole entity', () => {
        // Provide takes SetComponent(provided) instead of GetEntity so the
        // ambiguity report sees exactly what a provider touches (#261):
        // the provided component (written via SetComponent, read via
        // Optional) plus its declared factory args — and nothing more.
        expect([...accessSetOf(fooProvider.args).components].map(c => c.name).sort())
            .toEqual(['bar', 'foo']);
        expect(accessSetOf(fooProvider.args).allComponents).toBeFalse();
    });

    it('sets the provided component through SetComponent', () => {
        world.addSystem(fooProvider);
        world.addSystem(logSystem);

        const word1 = new Entity()
            .addComponent(BAR_COMPONENT, { y: 'hello' });
        world.entities.set('word1', word1);
        world.step();

        expect(word1.components.get(FOO_COMPONENT)).toEqual({ x: 5 });
    });
});

