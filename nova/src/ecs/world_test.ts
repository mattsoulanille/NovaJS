import 'jasmine';
import { Component } from './component';
import { Query } from './query';
import { Resource } from './resource';
import { System } from './system';
import * as t from 'io-ts';
import { World } from './world';
import { Entity } from './entity';
import { ReplaySubject } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { original } from 'immer';
import { Optional, UUID } from './arg_types';
import { Plugin } from './plugin';

const FOO_COMPONENT = new Component({
    name: 'foo',
    type: t.type({ x: t.number }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data;
    }
});

const BAR_COMPONENT = new Component({
    name: 'bar',
    type: t.type({ y: t.string }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data;
    }
});

const BAZ_RESOURCE = new Resource({
    name: 'baz',
    type: t.type({ z: t.array(t.string) }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data
    },
    multiplayer: true
})

const FOO_BAR_QUERY = new Query([FOO_COMPONENT, BAR_COMPONENT] as const);

const FOO_BAR_SYSTEM = new System({
    name: 'foobar',
    args: [FOO_COMPONENT, BAR_COMPONENT, BAZ_RESOURCE] as const,
    step: (foo, bar, baz) => {
        bar.y = bar.y + `${foo.x}`;
        foo.x = bar.y.length;
        baz.z.push(bar.y);
    }
});

describe('world', () => {
    let world: World;
    beforeEach(() => {
        world = new World();
    });

    it('throws an error if a system is added before its resources', () => {
        expect(() => world.addSystem(FOO_BAR_SYSTEM))
            .toThrowError('World is missing Resource(baz) needed for System(foobar)');
    });

    it('passes components to a system', async () => {
        const stepData = new ReplaySubject<[number, string]>();
        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT, BAR_COMPONENT] as const,
            step: (fooData, barData) => {
                stepData.next([fooData.x, barData.y]);
            }
        });

        world.addSystem(testSystem);
        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'asdf' })
        );
        world.step();

        await expectAsync(stepData.pipe(take(1)).toPromise())
            .toBeResolvedTo([123, 'asdf']);
    });

    it('passes entities to a system added after the entities', async () => {
        const stepData = new ReplaySubject<[number, string]>();
        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT, BAR_COMPONENT] as const,
            step: (fooData, barData) => {
                stepData.next([fooData.x, barData.y]);
            }
        });

        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'asdf' })
        );
        world.addSystem(testSystem);
        world.step();

        await expectAsync(stepData.pipe(take(1)).toPromise())
            .toBeResolvedTo([123, 'asdf']);
    });

    it('allows systems to modify components', async () => {
        const stepData = new ReplaySubject<number>();
        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT] as const,
            step: (fooData) => {
                fooData.x += 1;
                stepData.next(fooData.x);
            }
        });

        world.addSystem(testSystem);
        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 0 }));

        world.step();
        world.step();
        world.step();

        await expectAsync(stepData.pipe(take(3), toArray()).toPromise())
            .toBeResolvedTo([1, 2, 3]);
    });

    it('fulfills queries', async () => {
        const query = new Query([FOO_COMPONENT, BAR_COMPONENT, UUID] as const, "TestQuery");
        const stepData = new ReplaySubject<[number, string, string]>();
        const testSystem = new System({
            name: 'TestSystem',
            args: [query] as const,
            step: (queryData) => {
                for (let [{ x }, { y }, uuid] of queryData) {
                    stepData.next([x, y, uuid]);
                }
            }
        });

        world.addSystem(testSystem);
        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 0 }));
        world.commands.addEntity(new Entity({ uuid: 'example uuid' })
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'asdf' }));

        world.step();

        await expectAsync(stepData.pipe(take(1)).toPromise())
            .toBeResolvedTo([123, 'asdf', 'example uuid']);

    });

    it('passes resources to systems', async () => {
        const stepData = new ReplaySubject<string[]>();
        const testSystem = new System({
            name: 'TestSystem',
            args: [BAZ_RESOURCE, FOO_COMPONENT] as const,
            step: ({ z }) => {
                stepData.next([...z]);
            }
        });

        world.addResource(BAZ_RESOURCE, { z: ['foo', 'bar'] });
        world.addSystem(testSystem);
        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 }));

        world.step();

        await expectAsync(stepData.pipe(take(1)).toPromise())
            .toBeResolvedTo(['foo', 'bar']);
    })

    it('passes uuid to systems', async () => {
        const stepData = new ReplaySubject<string>();
        const testSystem = new System({
            name: 'TestSystem',
            args: [UUID, FOO_COMPONENT] as const,
            step: (uuid) => {
                stepData.next(uuid);
            }
        });

        world.addResource(BAZ_RESOURCE, { z: ['foo', 'bar'] });
        world.addSystem(testSystem);
        world.commands.addEntity(new Entity({ uuid: 'entityUuid' })
            .addComponent(FOO_COMPONENT, { x: 123 }));

        world.step();

        await expectAsync(stepData.pipe(take(1)).toPromise())
            .toBeResolvedTo('entityUuid');
    });

    it('runs systems in topological order', async () => {
        const stepData = new ReplaySubject<string>();

        const secondSystem = new System({
            name: 'SecondSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'second';
                stepData.next(bar.y);
            }
        });
        const firstSystem = new System({
            name: 'FirstSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'first';
                stepData.next(bar.y);
            },
            before: new Set([secondSystem]),
        });
        const fourthSystem = new System({
            name: 'FourthSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'fourth';
                stepData.next(bar.y);
            },
        });
        const thirdSystem = new System({
            name: 'ThirdSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'third';
                stepData.next(bar.y);
            },
            after: new Set([secondSystem]),
            before: new Set([fourthSystem]),
        });

        const world = new World();

        // Add systems in a random order
        let systems = [firstSystem, secondSystem, thirdSystem, fourthSystem];
        while (systems.length > 0) {
            const index = Math.floor(Math.random() * systems.length);
            world.addSystem(systems[index]);
            systems = [...systems.slice(0, index), ...systems.slice(index + 1)];
        }

        world.commands.addEntity(new Entity()
            .addComponent(BAR_COMPONENT, { y: 'unset' }));

        world.step();

        await expectAsync(stepData.pipe(take(4), toArray()).toPromise())
            .toBeResolvedTo(['first', 'second', 'third', 'fourth']);
    });

    it('allows getting the original state for a given step', async () => {
        const stepData = new ReplaySubject<string>();

        const firstSystem = new System({
            name: 'FirstSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'first';
            },
        });
        const secondSystem = new System({
            name: 'SecondSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                stepData.next(bar.y);
                const orig = original(bar);
                stepData.next(orig?.y ?? 'no original found');
            },
            after: new Set([firstSystem]),
        });

        world.commands.addEntity(new Entity()
            .addComponent(BAR_COMPONENT, { y: 'original value' }));

        world.addSystem(firstSystem)
            .addSystem(secondSystem);

        world.step();

        await expectAsync(stepData.pipe(take(2), toArray()).toPromise())
            .toBeResolvedTo(['first', 'original value'])
    });

    it('supports optional arguments in systems', async () => {
        const stepData = new ReplaySubject<[number, string | undefined]>();

        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT, Optional(BAR_COMPONENT)] as const,
            step: (foo, maybeBar) => {
                stepData.next([foo.x, maybeBar?.y]);
            },
        });

        world.addSystem(testSystem);
        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'FooBar' }));

        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 456 }));

        world.step();

        const stepDataContents = await stepData.pipe(take(2), toArray()).toPromise();

        expect(stepDataContents).toContain([123, 'FooBar']);
        expect(stepDataContents).toContain([456, undefined]);
    });

    it('supports optional arguments in queries', async () => {
        const query = new Query([FOO_COMPONENT, Optional(BAR_COMPONENT), UUID] as const);
        const stepData = new ReplaySubject<[number, number, string | undefined]>();
        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT, query] as const,
            step: (foo, queryData) => {
                for (let [{ x }, maybeBar] of queryData) {
                    stepData.next([foo.x, x, maybeBar?.y]);
                }
            }
        });

        world.addSystem(testSystem);
        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 }));
        world.commands.addEntity(new Entity({ uuid: 'example uuid' })
            .addComponent(FOO_COMPONENT, { x: 456 })
            .addComponent(BAR_COMPONENT, { y: 'asdf' }));

        world.step();

        const stepDataContents = await stepData.pipe(take(4), toArray()).toPromise();

        // On each run of testSystem (which runs for both entities), the query
        // iterates over each matching entity, which is why there are four results.
        expect(stepDataContents).toContain([123, 123, undefined]);
        expect(stepDataContents).toContain([123, 456, 'asdf']);
        expect(stepDataContents).toContain([456, 123, undefined]);
        expect(stepDataContents).toContain([456, 456, 'asdf']);
    });

    it('loads plugins', async () => {
        const stepData = new ReplaySubject<string>();

        const plugin: Plugin = {
            name: 'Test Plugin',
            build: (world) => {
                world.commands.addEntity(new Entity()
                    .addComponent(BAR_COMPONENT, { y: 'plugin component' }));
                world.addSystem(new System({
                    name: 'TestSystem',
                    args: [BAR_COMPONENT],
                    step: (bar) => {
                        stepData.next(bar.y);
                    }
                }));
            }
        };

        world.addPlugin(plugin);
        world.step();

        await expectAsync(stepData.pipe(take(1)).toPromise())
            .toBeResolvedTo('plugin component');
    });

    it('supports modifying an existing entity\'s components', async () => {
        const barData = new ReplaySubject<string>();
        const fooBarData = new ReplaySubject<[number, string]>();
        const barSystem = new System({
            name: 'BarSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                barData.next(bar.y);
            }
        });

        const fooBarSystem = new System({
            name: 'FooBarSystem',
            args: [FOO_COMPONENT, BAR_COMPONENT] as const,
            step: (foo, bar) => {
                bar.y = 'changed by foo';
                fooBarData.next([foo.x, bar.y]);
            },
            before: new Set([barSystem])
        });

        world.addSystem(fooBarSystem);
        world.addSystem(barSystem);

        const entity = world.commands.addEntity(new Entity());
        world.step();
        entity.addComponent(BAR_COMPONENT, { y: 'added bar' });
        world.step();
        entity.addComponent(FOO_COMPONENT, { x: 123 });
        world.step();
        entity.removeComponent(FOO_COMPONENT);
        world.step();
        entity.removeComponent(BAR_COMPONENT);
        world.step();

        await expectAsync(barData.pipe(take(3), toArray()).toPromise())
            .toBeResolvedTo(['added bar', 'changed by foo', 'changed by foo']);
        await expectAsync(fooBarData.pipe(take(1)).toPromise())
            .toBeResolvedTo([123, 'changed by foo']);
    });

    it('removes entities', async () => {
        const stepData = new ReplaySubject<[string, number]>();

        const testSystem = new System({
            name: 'TestSystem',
            args: [BAR_COMPONENT, FOO_COMPONENT] as const,
            step: ({ y }, foo) => {
                foo.x += 1;
                stepData.next([y, foo.x]);
            }
        });

        const e1 = world.commands.addEntity(new Entity()
            .addComponent(BAR_COMPONENT, { y: 'e1' })
            .addComponent(FOO_COMPONENT, { x: 0 }));
        world.commands.addEntity(new Entity()
            .addComponent(BAR_COMPONENT, { y: 'e2' })
            .addComponent(FOO_COMPONENT, { x: 0 }));

        world.addSystem(testSystem);
        world.step();
        const entityBlueprint = world.commands.removeEntity(e1);
        expect(entityBlueprint).toBeDefined();
        world.step();
        world.commands.addEntity(entityBlueprint!);
        world.step();

        await expectAsync(stepData.pipe(take(5), toArray()).toPromise())
            .toBeResolvedTo([
                ['e1', 1],
                ['e2', 1],
                // e1 removed
                ['e2', 2],
                // e1 added back in
                ['e2', 3],
                ['e1', 2]
            ]);
    });

    it('destroys entity handles when the entity is removed', () => {
        const handle1 = world.commands.addEntity(new Entity());
        world.commands.removeEntity(handle1);

        const handle2 = world.commands.addEntity(new Entity());
        world.commands.removeEntity(handle2.uuid);

        expect(() => handle1.addComponent(FOO_COMPONENT, { x: 123 }))
            .toThrowError('Entity not in system');
        expect(() => handle1.removeComponent(FOO_COMPONENT))
            .toThrowError('Entity not in system');

        expect(() => handle2.addComponent(FOO_COMPONENT, { x: 123 }))
            .toThrowError('Entity not in system');
        expect(() => handle2.removeComponent(FOO_COMPONENT))
            .toThrowError('Entity not in system');
    });

    it('provides a singleton entity', async () => {
        const stepData = new ReplaySubject<string>();

        const testSystem = new System({
            name: 'TestSystem',
            args: [BAR_COMPONENT] as const,
            step: ({ y }) => {
                stepData.next(y);
            }
        });

        world.singletonEntity.addComponent(BAR_COMPONENT, { y: 'singleton' });
        world.addSystem(testSystem);
        world.step();

        await expectAsync(stepData.pipe(take(1)).toPromise())
            .toBeResolvedTo('singleton')
    });

    it('does not permit the singleton entity to be removed', () => {
        expect(() => world.commands.removeEntity(world.singletonEntity))
            .toThrowError('Cannot remove singleton entity');
    });

    it('does not allow systems to have the same name', () => {
        const system1 = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT],
            step: () => { }
        });

        const system2 = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT],
            step: () => { }
        });

        world.addSystem(system1);

        expect(() => world.addSystem(system2))
            .toThrowError(`A system with name ${system2.name} already exists`);
    });

    it('does not allow resources to have the same name', () => {
        const resource1 = new Resource({
            name: 'TestResource',
            type: t.string,
            getDelta: () => { },
            applyDelta: () => { },
        });

        const resource2 = new Resource({
            name: 'TestResource',
            type: t.string,
            getDelta: () => { },
            applyDelta: () => { },
        });

        world.addResource(resource1, 'foobar');
        expect(() => world.addResource(resource2, 'foobar'))
            .toThrowError(`A resource with name ${resource2.name} already exists`);
    });

    it('does not allow components to have the same name', () => {
        const component1 = new Component({
            name: 'TestComponent',
            type: t.string,
            getDelta: () => { },
            applyDelta: () => { },
        });

        const component2 = new Component({
            name: 'TestComponent',
            type: t.string,
            getDelta: () => { },
            applyDelta: () => { },
        });

        const testSystem = new System({
            name: 'TestSystem',
            args: [component1, component2] as const,
            step: () => { }
        });

        expect(() => world.addSystem(testSystem))
            .toThrowError(`A component with name ${component1.name} already exists`);
    });

    it('catches component name conflicts when adding them to entities', () => {
        const component1 = new Component({
            name: 'TestComponent',
            type: t.string,
            getDelta: () => { },
            applyDelta: () => { },
        });

        const component2 = new Component({
            name: 'TestComponent',
            type: t.string,
            getDelta: () => { },
            applyDelta: () => { },
        });

        const handle = world.commands.addEntity(new Entity()
            .addComponent(component1, 'foobar'));

        expect(() => handle.addComponent(component2, 'foobar'))
            .toThrowError(`A component with name ${component1.name} already exists`);
    })
});
