import { Patch } from 'immer';
import * as t from 'io-ts';
import 'jasmine';
import { GetEntity } from '../arg_types';
import { Component } from '../component';
import { set } from '../datatypes/set';
import { Entity } from '../entity';
import { System } from '../system';
import { World } from '../world';
import { DeltaMaker, DeltaPlugin, DeltaResource, OptionalComponentDelta } from './delta_plugin';

const FooComponent = new Component<{ x: number }>('Foo');
const FooType = t.type({ x: t.number });
const BarComponent = new Component<{ y: string }>('Bar');
const BarType = t.type({ y: t.string });

const SetComponent = new Component<{ s: Set<string> }>('Set');
const SetType = t.type({ s: set(t.string) });

const FooDelta: OptionalComponentDelta<{ x: number }> = {
    componentType: FooType,
    // deltaType: t.number,
    // getDelta(a, b) {
    //     if (a.x !== b.x) {
    //         return b.x;
    //     }
    //     return;
    // },
    // applyDelta(foo, delta) {
    //     foo.x = delta
    // },
}

const BarDelta: OptionalComponentDelta<{ y: string }> = { componentType: BarType };
const SetDelta: OptionalComponentDelta<{ s: Set<string> }> = { componentType: SetType };

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

        for (const deltaMaker of [deltaMaker1, deltaMaker2]) {
            deltaMaker.addComponent(FooComponent, FooDelta);
            deltaMaker.addComponent(BarComponent, BarDelta);
            deltaMaker.addComponent(SetComponent, SetDelta);
        }
    });

    it('returns no delta for identical entities', () => {
        const entity1 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })

        const entity2 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })

        const delta = deltaMaker1.getDelta(entity1, entity2);

        expect(delta).toBeUndefined();
    });

    it('sends the state of new components', () => {
        const entity1 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })

        const entity2 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' });

        const delta = deltaMaker1.getDelta(entity1, entity2);

        expect(delta?.componentStates).toBeDefined();
        expect([...delta!.componentStates!.keys()]).toEqual(['Bar']);
        expect(delta?.componentDeltas).toBeUndefined();
        expect(delta?.removeComponents).toBeUndefined();
    });

    it('creates new components that were sent', () => {
        const entity1 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })

        const entity2 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' });

        const delta = deltaMaker1.getDelta(entity1, entity2);
        if (!delta) {
            fail('Expected delta to be defined');
            return;
        }

        deltaMaker2.applyDelta(entity1, delta);

        expect([...entity1.components]).toEqual([...entity2.components]);
    });

    it('sends an update for changed components', () => {
        const entity1 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' });

        const entity2 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 456 })
            .addComponent(BarComponent, { y: 'Hello' });

        const delta = deltaMaker1.getDelta(entity1, entity2);

        expect(delta?.componentStates).toBeDefined();
        expect([...delta!.componentStates!.keys()]).toEqual(['Foo']);
        expect(delta?.componentDeltas).toBeUndefined();
        expect(delta?.removeComponents).toBeUndefined();
    });

    it('updates components with deltas', () => {
        const entity1 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' });

        const entity2 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 456 })
            .addComponent(BarComponent, { y: 'Hello' });

        const delta = deltaMaker1.getDelta(entity1, entity2);
        expect(delta).toBeDefined();

        deltaMaker2.applyDelta(entity1, delta!);

        expect([...entity1.components]).toEqual([...entity2.components]);  
    });

    it('sends an update for deleted components', () => {
        const entity1 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' });

        const entity2 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 });

        const delta = deltaMaker1.getDelta(entity1, entity2);

        expect(delta?.removeComponents).toBeDefined();
        expect(delta?.removeComponents).toContain(BarComponent.name);
    });

    it('removes deleted components', () => {
        const entity1 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' });

        const entity2 = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 });

        const delta = deltaMaker1.getDelta(entity1, entity2);
        if (!delta) {
            fail('Expected delta to be defined');
            return;
        }

        deltaMaker2.applyDelta(entity1, delta);

        expect([...entity1.components]).toEqual([...entity2.components]);  
    });
});
