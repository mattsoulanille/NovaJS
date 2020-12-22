import 'jasmine';
import { Component } from './component';
import { Query } from './query';
import { Resource } from './resource';
import { System } from './system';
import * as t from 'io-ts';
import { UUID, World } from './world';
import { Entity } from './entity';
import { ReplaySubject } from 'rxjs';
import { take, toArray } from 'rxjs/operators';

const FOO_COMPONENT = new Component({
    type: t.type({ x: t.number }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data;
    }
});

const BAR_COMPONENT = new Component({
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

        await expectAsync(stepData.pipe(take(1), toArray()).toPromise())
            .toBeResolvedTo([[123, 'asdf']]);
    });

    it('passes components to a system added after the components', async () => {
        const stepData = new ReplaySubject<[number, string]>();
        const testSystem = new System({
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

        await expectAsync(stepData.pipe(take(1), toArray()).toPromise())
            .toBeResolvedTo([[123, 'asdf']]);
    });

    it('allows systems to modify components', async () => {
        const stepData = new ReplaySubject<number>();
        const testSystem = new System({
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
        const query = new Query([FOO_COMPONENT, BAR_COMPONENT] as const, "TestQuery");
        const stepData = new ReplaySubject<[number, string]>();
        const testSystem = new System({
            args: [query] as const,
            step: (queryData) => {
                for (let [{ x }, { y }] of queryData) {
                    stepData.next([x, y]);
                }
            }
        });
        world.addSystem(testSystem);
        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 0 }));
        world.commands.addEntity(new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'asdf' }));

        world.step();

        await expectAsync(stepData.pipe(take(1)).toPromise())
            .toBeResolvedTo([123, 'asdf']);

    });

    it('passes resources to systems', async () => {
        const stepData = new ReplaySubject<string[]>();
        const testSystem = new System({
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
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'second';
                stepData.next(bar.y);
            }
        });
        const firstSystem = new System({
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'first';
                stepData.next(bar.y);
            },
            before: new Set([secondSystem]),
        });
        const fourthSystem = new System({
            args: [BAR_COMPONENT] as const,
            step: (bar) => {
                bar.y = 'fourth';
                stepData.next(bar.y);
            },
        });
        const thirdSystem = new System({
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
});
