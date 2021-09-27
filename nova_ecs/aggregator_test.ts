import { Aggregator } from './aggregator';
import { GetWorld } from './arg_types';
import { Component } from './component';
import { EntityBuilder } from './entity';
import { Modifier } from './modifier';
import { Provide } from './provider';
import { Resource } from './resource';
import { System } from './system';
import { World } from './world';


const FOO_COMPONENT = new Component<{ x: number }>('foo');
const BAR_COMPONENT = new Component<{ y: string }>('bar');
const BAZ_COMPONENT = new Component<{ z: string[] }>('baz');

describe('Aggregator', () => {
    const FooFromBar = Provide({
        provided: FOO_COMPONENT,
        args: [BAR_COMPONENT] as const,
        update: [BAR_COMPONENT],
        factory(bar) {
            return { x: bar.y.length };
        }
    });

    const FooFromBaz = Provide({
        provided: FOO_COMPONENT,
        args: [BAZ_COMPONENT] as const,
        factory(baz) {
            return { x: baz.z.length };
        }
    });

    let world: World;
    beforeEach(() => {
        world = new World();
    });

    it('creates a resource and a modifier', () => {
        const [FooProviders, FooAggregator] = Aggregator(FOO_COMPONENT);
        expect(FooProviders).toBeInstanceOf(Resource);
        expect(FooAggregator).toBeInstanceOf(Modifier);
    });

    it('aggregates providers', () => {
        const [FooProviders, FooAggregator] = Aggregator(FOO_COMPONENT);
        world.resources.set(FooProviders, [FooFromBar, FooFromBaz]);

        const foos: number[] = [];
        const FooSystem = new System({
            name: 'FooSystem',
            args: [FooAggregator] as const,
            step(foo) {
                foos.push(foo.x);
            }
        });

        world.addSystem(FooSystem);
        world.entities.set('has bar', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'test string' }));
        world.entities.set('has baz', new EntityBuilder()
            .addComponent(BAZ_COMPONENT, { z: ['a', 'b', 'c'] }));

        world.step()
        expect(foos).toContain('test string'.length);
        expect(foos).toContain(3);
        expect(foos.length).toEqual(2);
    });

    it('lets providers update their provided value', () => {
        const [FooProviders, FooAggregator] = Aggregator(FOO_COMPONENT);
        world.resources.set(FooProviders, [FooFromBaz, FooFromBar]);

        const foos: number[] = [];
        const FooSystem = new System({
            name: 'FooSystem',
            args: [FooAggregator] as const,
            step(foo) {
                foos.push(foo.x);
            }
        });

        world.addSystem(FooSystem);

        world.entities.set('has bar', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'test string' }));
        world.step();

        expect(foos).toContain('test string'.length);
        expect(foos.length).toEqual(1);

        world.entities.get('has bar')!.components
            .set(BAR_COMPONENT, { y: 'another string' });
        world.step();

        expect(foos).toContain('another string'.length);
        expect(foos.length).toEqual(2);
    });

    xit('allows adding a new provider', () => {
        const [FooProviders, FooAggregator] = Aggregator(FOO_COMPONENT);
        world.resources.set(FooProviders, [FooFromBar]);

        const foos: number[] = [];
        const FooSystem = new System({
            name: 'FooSystem',
            args: [FooAggregator] as const,
            step(foo) {
                foos.push(foo.x);
            }
        });

        world.addSystem(FooSystem);
        world.entities.set('has bar', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'test string' }));
        world.entities.set('has baz', new EntityBuilder()
            .addComponent(BAZ_COMPONENT, { z: ['a', 'b', 'c'] }));

        world.step()
        expect(foos).toContain('test string'.length);
        expect(foos.length).toEqual(1);

        world.resources.get(FooProviders)!.push(FooFromBaz);
        world.step();
        expect(foos).toContain(['a', 'b', 'c'].length);
        expect(foos.length).toEqual(3);
    });

    it('always provides the component itself by default', () => {
        const [FooProviders, FooAggregator] = Aggregator(FOO_COMPONENT);
        world.resources.set(FooProviders, []);

        const foos: number[] = [];
        const FooSystem = new System({
            name: 'FooSystem',
            args: [FooAggregator] as const,
            step(foo) {
                foos.push(foo.x);
            }
        });
        world.addSystem(FooSystem);

        world.entities.set('has foo', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 }));

        world.step();

        expect(foos).toEqual([123]);
    });

    it('earlier providers take precedence', () => {
        const [FooProviders, FooAggregator] = Aggregator(FOO_COMPONENT);
        const world2 = new World('world2');
        world.resources.set(FooProviders, [FooFromBaz, FooFromBar]);
        world2.resources.set(FooProviders, [FooFromBar, FooFromBaz]);

        const foos: number[] = [];
        const foos2: number[] = [];
        const FooSystem = new System({
            name: 'FooSystem',
            args: [FooAggregator, GetWorld] as const,
            step(foo, world) {
                if (world.name === 'world2') {
                    foos2.push(foo.x);
                } else {
                    foos.push(foo.x);
                }
            }
        });

        world.addSystem(FooSystem);
        world2.addSystem(FooSystem);

        world.entities.set('has foo and bar', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'test string' })
            .addComponent(BAZ_COMPONENT, { z: ['a', 'b', 'c'] }));
        world2.entities.set('has foo and bar', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'test string' })
            .addComponent(BAZ_COMPONENT, { z: ['a', 'b', 'c'] }));
        world.step();
        world2.step();

        expect(foos).toContain(['a', 'b', 'c'].length);
        expect(foos.length).toEqual(1);

        expect(foos2).toContain('test string'.length);
        expect(foos2.length).toEqual(1);
    });
});
