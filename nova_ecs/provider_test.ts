import 'jasmine';
import { Component } from './component';
import { EntityBuilder } from './entity';
import { Provide } from './provider';
import { Resource } from './resource';
import { System } from './system';
import { World } from './world';


async function sleep(ms: number) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

const FOO_COMPONENT = new Component<{ x: number }>({ name: 'foo' });
const BAR_COMPONENT = new Component<{ y: string }>({ name: 'bar' });
const BAZ_RESOURCE = new Resource<{ z: string[] }>({ name: 'baz' });

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

    // it('provides a component asynchronously', () => {
    //     const world = new World();

    //     const fooProvider = Provide({
    //         provided: FOO_COMPONENT,
    //         args: [BAR_COMPONENT] as const,
    //         factory: async (bar) => {
    //             await sleep(10);
    //             return {
    //                 x: bar.y.length
    //             }
    //         }
    //     });

    //     const wordLengths: [string, number][] = [];

    //     const providesFoo = new System({
    //         name: 'providesFoo',
    //         args: [BAR_COMPONENT, fooProvider] as const,
    //         step: (bar, foo) => {
    //             wordLengths.push([bar.y, foo.x]);
    //         }
    //     });

    //     world.addSystem(providesFoo);

    //     world.entities.set('word1', new EntityBuilder()
    //         .addComponent(BAR_COMPONENT, { y: 'hello' }).build());

    //     world.step();
    //     expect(wordLengths).toEqual([]);
    //     clock.tick(11);
    //     world.step();
    //     expect(wordLengths).toEqual([['hello', 5]]);
    // });
});
