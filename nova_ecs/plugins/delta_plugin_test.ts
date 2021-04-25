import { Patch } from 'immer';
import * as t from 'io-ts';
import 'jasmine';
import { GetEntity } from 'nova_ecs/arg_types';
import { Component } from '../component';
import { set } from '../datatypes/set';
import { EntityBuilder } from '../entity';
import { System } from '../system';
import { World } from '../world';
import { DeltaMaker, DeltaPlugin, DeltaResource, OptionalComponentDelta } from './delta_plugin';

const FooComponent = new Component<{ x: number }>('Foo');
const FooType = t.type({ x: t.number });
const BarComponent = new Component<{ y: string }>('Bar');
const BarType = t.type({ y: t.string });

const SetComponent = new Component<{ s: Set<string> }>('Set');
const SetType = t.type({ s: set(t.string) });

const FooDelta: OptionalComponentDelta<{ x: number }, number> = {
    componentType: FooType,
    deltaType: t.number,
    getDelta(a, b) {
        if (a.x !== b.x) {
            return b.x;
        }
        return;
    },
    applyDelta(foo, delta) {
        foo.x = delta
    },
}

const BarDelta: OptionalComponentDelta<{ y: string }, Patch[]> = { componentType: BarType };
const SetDelta: OptionalComponentDelta<{ s: Set<string> }, Patch[]> = { componentType: SetType };


describe('Delta Plugin', () => {
    let world1: World;
    let world2: World;
    let deltaMaker1: DeltaMaker;
    let deltaMaker2: DeltaMaker;

    beforeEach(() => {
        world1 = new World();
        world1.addPlugin(DeltaPlugin);
        world2 = new World();
        world2.addPlugin(DeltaPlugin);

        const maybeDelta1 = world1.resources.get(DeltaResource);
        if (!maybeDelta1) {
            throw new Error('Expected world 1 to have delta resource');
        }
        deltaMaker1 = maybeDelta1;

        const maybeDelta2 = world2.resources.get(DeltaResource);
        if (!maybeDelta2) {
            throw new Error('Expected world 2 to have delta resource');
        }
        deltaMaker2 = maybeDelta2;

        deltaMaker1.addComponent(FooComponent, FooDelta);
        deltaMaker1.addComponent(BarComponent, BarDelta);
        deltaMaker1.addComponent(SetComponent, SetDelta);

        deltaMaker2.addComponent(FooComponent, FooDelta);
        deltaMaker2.addComponent(BarComponent, BarDelta);
        deltaMaker2.addComponent(SetComponent, SetDelta);
    });

    it('sends the state of new components', () => {
        const entity = new EntityBuilder()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' })
            .build();

        const firstDelta = deltaMaker1.getDelta(entity);
        if (!firstDelta?.componentStates) {
            fail('Expected firstDelta to have component states');
            return;
        }

        expect([...firstDelta.componentStates?.keys()])
            .toEqual(['Foo', 'Bar']);

        expect(firstDelta.componentDeltas).toBeUndefined();
        expect(firstDelta.removeComponents).toBeUndefined();

        const secondDelta = deltaMaker1.getDelta(entity);
        expect(secondDelta).toBeUndefined();
    });

    it('sends the state of replaced components', () => {
        const entity = new EntityBuilder()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' })
            .build();

        const firstDelta = deltaMaker1.getDelta(entity);
        if (!firstDelta?.componentStates) {
            fail('Expected firstDelta to have component states');
            return;
        }

        expect([...firstDelta.componentStates?.keys()])
            .toEqual(['Foo', 'Bar']);

        expect(firstDelta.componentDeltas).toBeUndefined();
        expect(firstDelta.removeComponents).toBeUndefined();

        entity.components.set(FooComponent, { x: 456 });

        const secondDelta = deltaMaker1.getDelta(entity);
        if (!secondDelta?.componentStates) {
            fail('Expected secondDelta to have component states');
            return;
        }
        expect([...secondDelta.componentStates.keys()])
            .toEqual(['Foo']);

        expect(secondDelta.componentDeltas).toBeUndefined();
        expect(secondDelta.removeComponents).toBeUndefined();
    });

    it('creates new components that were sent', () => {
        const entity = new EntityBuilder()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' })
            .build();

        const delta = deltaMaker1.getDelta(entity);
        if (!delta) {
            fail('Expected delta to be defined');
            return;
        }

        const entity2 = new EntityBuilder().build();
        deltaMaker2.applyDelta(entity2, delta);

        expect(entity2.components.get(FooComponent))
            .toEqual(entity.components.get(FooComponent));

        expect(entity2.components.get(BarComponent))
            .toEqual(entity.components.get(BarComponent));
    });

    it('updates components with deltas', () => {
        const entity = new EntityBuilder()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' })
            .addComponent(SetComponent, { s: new Set(['asdf']) })
            .build();

        const entity2 = new EntityBuilder(entity).build();

        const fooBarSystem = new System({
            name: 'FooBarSystem',
            args: [FooComponent, BarComponent] as const,
            step: (foo, bar) => {
                foo.x += 1;
                bar.y = String(foo.x);
            }
        });

        world1.addSystem(fooBarSystem);
        world1.entities.set('test entity uuid', entity);

        // Skip the first delta since it will send the state
        // of each new component.
        deltaMaker1.getDelta(entity);
        world1.step();
        const delta2 = deltaMaker1.getDelta(entity);
        if (!delta2) {
            fail('Expected delta2 to be defined');
            return;
        }

        deltaMaker2.applyDelta(entity2, delta2);

        expect(delta2.componentDeltas).toBeDefined();
        expect(delta2.componentStates).toBeUndefined();
        expect(delta2.removeComponents).toBeUndefined();
        expect([...delta2.componentDeltas!.keys()]).toEqual(['Foo', 'Bar']);

        expect(entity.components.get(FooComponent)).toEqual({ x: 124 });
        expect(entity2.components.get(FooComponent)).toEqual({ x: 124 });

        expect(entity.components.get(BarComponent)).toEqual({ y: '124' });
        expect(entity2.components.get(BarComponent)).toEqual({ y: '124' });
    });

    it('removes deleted components', () => {
        const entity = new EntityBuilder()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' })
            .build();

        const entity2 = new EntityBuilder(entity).build();

        const removeFooSystem = new System({
            name: 'FooBarSystem',
            args: [GetEntity, FooComponent] as const,
            step: (entity) => {
                entity.components.delete(FooComponent);
            }
        });

        world1.addSystem(removeFooSystem);
        world1.entities.set('test entity uuid', entity);

        // Skip the first delta since it will send the state
        // of each new component.
        deltaMaker1.getDelta(entity);
        world1.step();
        const delta2 = deltaMaker1.getDelta(entity);
        if (!delta2) {
            fail('Expected delta2 to be defined');
            return;
        }

        expect(entity2.components.get(FooComponent)).toEqual({ x: 123 });
        deltaMaker2.applyDelta(entity2, delta2);
        expect(entity2.components.get(FooComponent)).toBeUndefined();

        expect(delta2.componentDeltas).toBeUndefined();
        expect(delta2.componentStates).toBeUndefined();
        expect(delta2.removeComponents).toEqual(new Set(['Foo']));
    });
});
