import { original } from 'immer';
import * as t from 'io-ts';
import 'jasmine';
import { v4 } from 'uuid';
import { Entities, GetEntity, UUID } from './arg_types';
import { Component, ComponentData } from './component';
import { EntityBuilder } from './entity';
import { DeleteEvent } from './events';
import { Optional } from './optional';
import { Plugin } from './plugin';
import { Query } from './query';
import { Resource, ResourceData } from './resource';
import { System } from './system';
import { World } from './world';


const FOO_COMPONENT = new Component<{ x: number }>({ name: 'foo' });

const BAR_COMPONENT = new Component<{ y: string }>({ name: 'bar' });

const BAZ_RESOURCE = new Resource<{ z: string[] }>({ name: 'baz' })

const FOO_BAR_SYSTEM = new System({
    name: 'foobar',
    args: [FOO_COMPONENT, BAR_COMPONENT, BAZ_RESOURCE] as const,
    step: (foo, bar, baz) => {
        bar.y = bar.y + `${foo.x}`;
        foo.x = bar.y.length;
        baz.z.push(bar.y);
    }
});

class MutableObject {
    constructor(public val: string) { }
}

const MUTABLE_COMPONENT = new Component<MutableObject>({
    name: 'MutableComponent'
})

describe('world', () => {
    let world: World;
    beforeEach(() => {
        world = new World();
    });

    it('can step an empty world', () => {
        world.step();
    });

    it('throws an error if a system is added before its resources', () => {
        expect(() => world.addSystem(FOO_BAR_SYSTEM))
            .toThrowError('World is missing Resource(baz) needed for System(foobar)');
    });

    it('passes components to a system', () => {
        const stepData: [number, string][] = [];
        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT, BAR_COMPONENT] as const,
            step: (fooData, barData) => {
                stepData.push([fooData.x, barData.y]);
            }
        });

        world.addSystem(testSystem);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'asdf' })
            .build()
        );
        world.step();

        expect(stepData).toEqual([[123, 'asdf']]);
    });

    it('passes entities to a system added after the entities', () => {
        const stepData: [number, string][] = [];
        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT, BAR_COMPONENT] as const,
            step: (fooData, barData) => {
                stepData.push([fooData.x, barData.y]);
            }
        });

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'asdf' })
        );
        world.addSystem(testSystem);
        world.step();

        expect(stepData).toEqual([[123, 'asdf']]);
    });

    it('allows systems to modify components', () => {
        const stepData: number[] = [];
        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT] as const,
            step: (fooData) => {
                fooData.x += 1;
                stepData.push(fooData.x);
            }
        });

        world.addSystem(testSystem);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 0 }));

        world.step();
        world.step();
        world.step();

        expect(stepData).toEqual([1, 2, 3]);
    });

    it('fulfills queries', () => {
        const query = new Query([FOO_COMPONENT, BAR_COMPONENT, UUID] as const, "TestQuery");
        const stepData: [number, string, string][] = [];
        const testSystem = new System({
            name: 'TestSystem',
            args: [query] as const,
            step: (queryData) => {
                for (let [{ x }, { y }, uuid] of queryData) {
                    stepData.push([x, y, uuid]);
                }
            }
        });

        world.addSystem(testSystem);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 0 }));
        world.entities.set('example uuid', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'asdf' }));

        world.step();

        // Appears three times because each entity ran the testSystem
        // including the singleton entity.
        expect(stepData).toEqual([
            [123, 'asdf', 'example uuid'],
            [123, 'asdf', 'example uuid'],
            [123, 'asdf', 'example uuid']
        ]);
    });

    it('passes resources to systems', () => {
        const stepData: string[][] = [];
        const testSystem = new System({
            name: 'TestSystem',
            args: [BAZ_RESOURCE, FOO_COMPONENT] as const,
            step: ({ z }) => {
                stepData.push([...z]);
            }
        });

        world.resources.set(BAZ_RESOURCE, { z: ['foo', 'bar'] });
        world.addSystem(testSystem);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 }));

        world.step();

        expect(stepData).toEqual([['foo', 'bar']]);
    })

    it('passes uuid to systems', () => {
        const stepData: string[] = [];
        const testSystem = new System({
            name: 'TestSystem',
            args: [UUID, FOO_COMPONENT] as const,
            step: (uuid) => {
                stepData.push(uuid);
            }
        });

        world.resources.set(BAZ_RESOURCE, { z: ['foo', 'bar'] });
        world.addSystem(testSystem);
        world.entities.set('entityUuid', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 }));

        world.step();

        expect(stepData).toEqual(['entityUuid']);
    });

    it('runs systems in topological order', () => {
        const stepData: string[] = [];

        const secondSystem = new System({
            name: 'SecondSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'second';
                stepData.push(bar.y);
            }
        });
        const firstSystem = new System({
            name: 'FirstSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'first';
                stepData.push(bar.y);
            },
            before: [secondSystem],
        });
        const fourthSystem = new System({
            name: 'FourthSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'fourth';
                stepData.push(bar.y);
            },
        });
        const thirdSystem = new System({
            name: 'ThirdSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'third';
                stepData.push(bar.y);
            },
            after: [secondSystem],
            before: [fourthSystem],
        });

        const world = new World();

        // Add systems in a random order
        let systems = [firstSystem, secondSystem, thirdSystem, fourthSystem];
        while (systems.length > 0) {
            const index = Math.floor(Math.random() * systems.length);
            world.addSystem(systems[index]);
            systems = [...systems.slice(0, index), ...systems.slice(index + 1)];
        }

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'unset' }));

        world.step();

        expect(stepData).toEqual(['first', 'second', 'third', 'fourth']);
    });

    it('supports referencing systems by name for ordering', () => {
        const stepData: string[] = [];

        const secondSystem = new System({
            name: 'SecondSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'second';
                stepData.push(bar.y);
            }
        });
        const firstSystem = new System({
            name: 'FirstSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'first';
                stepData.push(bar.y);
            },
            before: ['SecondSystem'],
        });
        const fourthSystem = new System({
            name: 'FourthSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'fourth';
                stepData.push(bar.y);
            },
        });
        const thirdSystem = new System({
            name: 'ThirdSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'third';
                stepData.push(bar.y);
            },
            after: ['SecondSystem'],
            before: ['FourthSystem'],
        });

        const world = new World();

        // Add systems in a random order
        let systems = [firstSystem, secondSystem, thirdSystem, fourthSystem];
        while (systems.length > 0) {
            const index = Math.floor(Math.random() * systems.length);
            world.addSystem(systems[index]);
            systems = [...systems.slice(0, index), ...systems.slice(index + 1)];
        }

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'unset' }));

        world.step();

        expect(stepData).toEqual(['first', 'second', 'third', 'fourth']);
    });

    it('allows getting the original state for a given step', () => {
        const stepData: string[] = [];

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
                stepData.push(bar.y);
                const orig = original(bar);
                stepData.push(orig?.y ?? 'no original found');
            },
            after: new Set([firstSystem]),
        });

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'original value' }));

        world.addSystem(firstSystem)
            .addSystem(secondSystem);

        world.step();

        expect(stepData).toEqual(['first', 'original value']);
    });

    it('supports optional arguments in systems', () => {
        const stepData: [number, string | undefined][] = [];

        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT, Optional(BAR_COMPONENT)] as const,
            step: (foo, maybeBar) => {
                stepData.push([foo.x, maybeBar?.y]);
            },
        });

        world.addSystem(testSystem);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'FooBar' }));

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 456 }));

        world.step();

        expect(stepData).toContain([123, 'FooBar']);
        expect(stepData).toContain([456, undefined]);
    });

    it('supports optional arguments in queries', () => {
        const query = new Query([FOO_COMPONENT, Optional(BAR_COMPONENT), UUID] as const);
        const stepData: [number, number, string | undefined][] = [];
        const testSystem = new System({
            name: 'TestSystem',
            args: [FOO_COMPONENT, query] as const,
            step: (foo, queryData) => {
                for (let [{ x }, maybeBar] of queryData) {
                    stepData.push([foo.x, x, maybeBar?.y]);
                }
            }
        });

        world.addSystem(testSystem);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 }));
        world.entities.set('example uuid', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 456 })
            .addComponent(BAR_COMPONENT, { y: 'asdf' }));

        world.step();

        // On each run of testSystem (which runs for both entities), the query
        // iterates over each matching entity, which is why there are four results.
        expect(stepData).toContain([123, 123, undefined]);
        expect(stepData).toContain([123, 456, 'asdf']);
        expect(stepData).toContain([456, 123, undefined]);
        expect(stepData).toContain([456, 456, 'asdf']);
    });

    it('loads plugins', () => {
        const stepData: string[] = [];
        const plugin: Plugin = {
            name: 'Test Plugin',
            build: (world) => {
                world.entities.set(v4(), new EntityBuilder()
                    .addComponent(BAR_COMPONENT, { y: 'plugin component' }));
                world.addSystem(new System({
                    name: 'TestSystem',
                    args: [BAR_COMPONENT],
                    step: (bar) => {
                        stepData.push(bar.y);
                    }
                }));
            }
        };

        world.addPlugin(plugin);
        world.step();

        expect(stepData).toEqual(['plugin component']);
    });

    it('supports modifying an existing entity\'s components', () => {
        const barData: string[] = [];
        const fooBarData: [number, string][] = [];
        const barSystem = new System({
            name: 'BarSystem',
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                barData.push(bar.y);
            }
        });

        const fooBarSystem = new System({
            name: 'FooBarSystem',
            args: [FOO_COMPONENT, BAR_COMPONENT] as const,
            step: (foo, bar) => {
                bar.y = 'changed by foo';
                fooBarData.push([foo.x, bar.y]);
            },
            before: new Set([barSystem])
        });

        world.addSystem(fooBarSystem);
        world.addSystem(barSystem);

        const uuid = v4();
        world.entities.set(uuid, new EntityBuilder());
        const entity = world.entities.get(uuid)!;
        world.step();
        entity.components.set(BAR_COMPONENT, { y: 'added bar' });
        world.step();
        entity.components.set(FOO_COMPONENT, { x: 123 });
        world.step();
        entity.components.delete(FOO_COMPONENT);
        world.step();
        entity.components.delete(BAR_COMPONENT);
        world.step();

        expect(barData).toEqual(['added bar', 'changed by foo', 'changed by foo']);
        expect(fooBarData).toEqual([[123, 'changed by foo']])
    });

    it('removes entities', () => {
        const stepData: [string, number][] = [];

        const testSystem = new System({
            name: 'TestSystem',
            args: [BAR_COMPONENT, FOO_COMPONENT] as const,
            step: ({ y }, foo) => {
                foo.x += 1;
                stepData.push([y, foo.x]);
            }
        });

        world.entities.set('e1 uuid', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'e1' })
            .addComponent(FOO_COMPONENT, { x: 0 }));
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'e2' })
            .addComponent(FOO_COMPONENT, { x: 0 }));

        world.addSystem(testSystem);
        world.step();
        const entityBlueprint = new EntityBuilder(world.entities.get('e1 uuid')).build();
        expect(entityBlueprint).toBeDefined();
        world.entities.delete('e1 uuid');
        world.step();
        world.entities.set(v4(), entityBlueprint!);
        world.step();

        expect(stepData).toEqual([
            ['e1', 1],
            ['e2', 1],
            // e1 removed
            ['e2', 2],
            // e1 added back in
            ['e2', 3],
            ['e1', 2]
        ]);
    });

    it('provides a singleton entity', () => {
        const stepData: string[] = [];

        const testSystem = new System({
            name: 'TestSystem',
            args: [BAR_COMPONENT] as const,
            step: ({ y }) => {
                stepData.push(y);
            }
        });

        world.singletonEntity.components.set(BAR_COMPONENT, { y: 'singleton' });
        world.addSystem(testSystem);
        world.step();

        expect(stepData).toEqual(['singleton']);
    });

    it('does not permit the singleton entity to be removed', () => {
        expect(() => world.entities.delete('singleton'))
            .toThrowError('Can not delete the singleton entity');
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

        world.resources.set(resource1, 'foobar');
        expect(() => world.resources.set(resource2, 'foobar'))
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

    it('catches component name conflicts', () => {
        const component1 = new Component<string>({ name: 'TestComponent' });
        const component2 = new Component<string>({ name: 'TestComponent' });

        world.addComponent(component1);

        expect(() => world.addComponent(component2))
            .toThrowError(`A component with name ${component1.name} already exists`);
    });

    it('catches component name conflicts when adding them to entities', () => {
        const component1 = new Component<string>({ name: 'TestComponent' });
        const component2 = new Component<string>({ name: 'TestComponent' });

        const uuid = v4();
        world.entities.set(uuid, new EntityBuilder()
            .addComponent(component1, 'foobar'));
        const handle = world.entities.get(uuid);

        expect(() => handle!.components.set(component2, 'foobar'))
            .toThrowError(`A component with name ${component1.name} already exists`);
    });

    it('provides systems with access to the entity handle', () => {
        const fooValues = new Set<number>();
        const testSystem = new System({
            name: 'TestSystem',
            args: [GetEntity, FOO_COMPONENT] as const,
            step: (entity) => {
                fooValues.add(entity.components.get(FOO_COMPONENT)!.x);
            }
        });

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 4 })
        );
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 7 })
        );

        world.addSystem(testSystem);
        world.step();

        expect(fooValues).toEqual(new Set([4, 7]));
    });

    it('provides access to components in the entity handle', () => {
        const barData: string[] = [];
        const testSystem = new System({
            name: 'TestSystem',
            args: [GetEntity, FOO_COMPONENT] as const,
            step: (entity) => {
                // Entity is known to have foo. Get bar from it too.
                const data = entity.components.get(BAR_COMPONENT);
                if (data) {
                    barData.push(data.y);
                }
            }
        });

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 7 })
            .addComponent(BAR_COMPONENT, { y: 'bar component data' })
        );

        world.addSystem(testSystem);
        world.step();

        expect(barData).toEqual(['bar component data']);
    });

    it('entity handle provides access to components added in the same step', () => {
        const barData: string[] = [];
        const addBarSystem = new System({
            name: 'AddBar',
            args: [GetEntity, FOO_COMPONENT] as const,
            step: (entity) => {
                entity.components.set(BAR_COMPONENT, { y: 'bar component data' });
            }
        });

        const testSystem = new System({
            name: 'TestSystem',
            args: [GetEntity, FOO_COMPONENT] as const,
            step: (entity) => {
                // Entity is known to have foo. Get bar from it too.
                const data = entity.components.get(BAR_COMPONENT);
                if (data) {
                    barData.push(data.y);
                }
            },
            after: [addBarSystem]
        });

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 7 })
        );

        world.addSystem(addBarSystem);
        world.addSystem(testSystem);
        world.step();

        expect(barData).toEqual(['bar component data']);
    });

    it('entity handle provides access to entities added in the same step', () => {
        const barData: string[] = [];
        const addEntitySystem = new System({
            name: 'AddEntity',
            args: [Entities, BAR_COMPONENT] as const,
            step: (entities) => {
                entities.set(v4(), new EntityBuilder()
                    .addComponent(FOO_COMPONENT, { x: 123 }));
            }
        });

        const testSystem = new System({
            name: 'TestSystem',
            args: [GetEntity, FOO_COMPONENT] as const,
            step: (entity) => {
                entity.components.set(BAR_COMPONENT, { y: 'bar component data' });
                entity.components.delete(FOO_COMPONENT);
                const data = entity.components.get(BAR_COMPONENT);
                if (data) {
                    barData.push(data.y);
                }
            },
            after: [addEntitySystem]
        });

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'not the right bar' })
        );

        world.addSystem(addEntitySystem);
        world.addSystem(testSystem);
        world.step();

        expect(barData).toEqual(['bar component data']);
    });

    it('supports adding a component to an entity within a system', () => {
        const results: Array<[number, string]> = [];
        const fooSystem = new System({
            name: 'FooSystem',
            args: [GetEntity, FOO_COMPONENT] as const,
            step: (entity, foo) => {
                entity.components.set(BAR_COMPONENT, { y: 'added bar' });
                foo.x = 123;
            }
        });

        const reportSystem = new System({
            name: 'ReportSystem',
            args: [FOO_COMPONENT, BAR_COMPONENT] as const,
            step: (foo, bar) => {
                results.push([foo.x, bar.y]);
            },
            after: new Set([fooSystem])
        });

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 4 })
        );

        world.addSystem(fooSystem);
        world.addSystem(reportSystem);
        world.step();

        expect(results).toEqual([[123, 'added bar']]);
    });

    it('provides queries with access to the entity handle', () => {
        const names = new Set<string>();
        const testSystem = new System({
            name: 'TestSystem',
            args: [new Query([GetEntity]), FOO_COMPONENT] as const,
            step: (query) => {
                for (const [entity] of query) {
                    if (entity.name) {
                        names.add(entity.name);
                    }
                }
            }
        });

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 4 })
            .setName('entity 1')
        );
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'hello' })
            .setName('entity 2')
        );

        world.addSystem(testSystem);
        world.step();

        expect(names).toEqual(new Set(['entity 1', 'entity 2', 'singleton']));
    });

    it('entity handle components are not part of a draft', () => {
        const testSystem = new System({
            name: 'TestSystem',
            args: [BAR_COMPONENT],
            step: (bar) => {
                bar.y = 'changed bar';
            }
        });

        const uuid = v4();
        world.entities.set(uuid, new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'not changed' }));

        const handle = world.entities.get(uuid)!;
        world.addSystem(testSystem);
        world.step();

        expect(handle.components.get(BAR_COMPONENT)?.y)
            .toEqual('changed bar');
    });

    it('supports immutable resources', () => {
        const pushed: string[] = [];
        const changeResourceSystem = new System({
            name: 'ChangeResourceSystem',
            args: [BAZ_RESOURCE],
            step: (baz) => {
                baz.z.push('hello');
                pushed.push('hello');
            }
        });

        const bazVal: ResourceData<typeof BAZ_RESOURCE> = { z: [] };
        world.resources.set(BAZ_RESOURCE, bazVal);
        world.addSystem(changeResourceSystem);

        world.step();

        expect(bazVal).toEqual({ z: [] });
        expect(pushed).toEqual(['hello']);
    });

    it('supports mutable resources', () => {
        const MutableResource = new Resource<MutableObject>({
            name: 'MutableResource',
        });

        const changeResourceSystem = new System({
            name: 'ChangeResourceSystem',
            args: [MutableResource],
            step: (mutableResource) => {
                mutableResource.val = 'changed';
            }
        });

        const resourceVal = new MutableObject('unchanged');
        world.resources.set(MutableResource, resourceVal);
        world.addSystem(changeResourceSystem);

        world.step();

        expect(resourceVal).toEqual(new MutableObject('changed'));
    });

    it('supports immutable components', () => {
        let changed = 'unchanged';
        const changeComponentSystem = new System({
            name: 'ChangeComponentSystem',
            args: [BAR_COMPONENT],
            step: (bar) => {
                bar.y = 'changed';
                changed = 'changed';
            }
        });

        const barVal: ComponentData<typeof BAR_COMPONENT> = { y: 'unchanged' };
        world.entities.set('example uuid', new EntityBuilder()
            .addComponent(BAR_COMPONENT, barVal)
            .build());

        world.addSystem(changeComponentSystem);

        world.step();

        expect(barVal).toEqual({ y: 'unchanged' });
        expect(changed).toEqual('changed');
    });

    it('supports mutable components', () => {
        const changeComponentSystem = new System({
            name: 'ChangeComponentSystem',
            args: [MUTABLE_COMPONENT],
            step: (mutableComponent) => {
                mutableComponent.val = 'changed';
            }
        });

        const componentVal = new MutableObject('unchanged');
        world.entities.set('example uuid', new EntityBuilder()
            .addComponent(MUTABLE_COMPONENT, componentVal)
            .build());

        world.addSystem(changeComponentSystem);

        world.step();

        expect(componentVal).toEqual(new MutableObject('changed'));
    });

    it('runs a delete system when an entity is removed', () => {
        const fooDeleted = new Set<number>();
        const barDeleted = new Set<string>();
        const deleteSystem = new System({
            name: 'barDeleted',
            event: DeleteEvent,
            args: [BAR_COMPONENT, FOO_COMPONENT] as const,
            step: (bar, foo) => {
                barDeleted.add(bar.y);
                fooDeleted.add(foo.x);
            }
        });

        world.addSystem(deleteSystem);
        world.entities.set('entity1', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'no foo' })
            .build());
        world.entities.set('entity2', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'has foo' })
            .build());
        world.entities.set('entity3', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 321 })
            .build());

        world.step();
        world.step();

        world.entities.delete('entity1');
        world.entities.delete('entity2');
        world.entities.delete('entity3');
        world.step();

        expect(barDeleted).toEqual(new Set(['has foo']));
        expect(fooDeleted).toEqual(new Set([123]));
    });

    it('runs a delete system when an entity is removed by a system', () => {
        const fooDeleted = new Set<number>();
        const barDeleted = new Set<string>();
        const onDeleteSystem = new System({
            name: 'barDeleted',
            event: DeleteEvent,
            args: [BAR_COMPONENT, FOO_COMPONENT] as const,
            step: (bar, foo) => {
                barDeleted.add(bar.y);
                fooDeleted.add(foo.x);
            }
        });

        const deleteBarEntities = new System({
            name: 'deleteBarEntities',
            args: [Entities, UUID, BAR_COMPONENT] as const,
            step: (entities, uuid) => {
                entities.delete(uuid);
            }
        });

        world.addSystem(onDeleteSystem);
        world.entities.set('entity1', new EntityBuilder()
            .addComponent(BAR_COMPONENT, { y: 'no foo' })
            .build());
        world.entities.set('entity2', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'has foo' })
            .build());
        world.entities.set('entity3', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 321 })
            .build());

        world.step();
        world.step();

        world.addSystem(deleteBarEntities);
        world.step();

        expect(barDeleted).toEqual(new Set(['has foo']));
        expect(fooDeleted).toEqual(new Set([123]));
    });

    it('runs the correct system if an entity\'s components are changed', () => {
        const foobars: [number, string][] = [];
        const fooBarSystem = new System({
            name: "FooBarSystem",
            args: [FOO_COMPONENT, BAR_COMPONENT] as const,
            step: (foo, bar) => {
                foobars.push([foo.x, bar.y]);
            }
        });

        world.addSystem(fooBarSystem);
        world.entities.set('e', new EntityBuilder()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'hello' })
            .build());

        const entity = world.entities.get('e')!;

        world.step();
        entity.components.delete(FOO_COMPONENT);
        world.step();
        entity.components.set(FOO_COMPONENT, { x: 456 });
        world.step();

        expect(foobars).toEqual([[123, 'hello'], [456, 'hello']]);
    });
});
