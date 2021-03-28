import { isLeft } from 'fp-ts/lib/Either';
import * as t from 'io-ts';
import 'jasmine';
import { EntityBuilder } from 'nova_ecs/entity';
import { Component } from '../component';
import { set } from '../datatypes/set';
import { World } from '../world';
import { Serializer, SerializerPlugin, SerializerResource } from './serializer_plugin';


const FooComponent = new Component<{ x: number }>('Foo');
const FooType = t.type({ x: t.number });
const BarComponent = new Component<{ y: string }>('Bar');
const BarType = t.type({ y: t.string });

const SetComponent = new Component<{ s: Set<string> }>('Set');
const SetType = t.type({ s: set(t.string) });


describe('Serializer Plugin', () => {
    let world: World;
    let serializer: Serializer;

    beforeEach(() => {
        world = new World();
        world.addPlugin(SerializerPlugin);

        const maybeSerializer = world.resources.get(SerializerResource);
        if (!maybeSerializer) {
            throw new Error('Expected world to have serializer resource');
        }
        serializer = maybeSerializer;
        serializer.addComponent(FooComponent, FooType);
        serializer.addComponent(BarComponent, BarType);
        serializer.addComponent(SetComponent, SetType);
    });

    it('serializes and deserializes entities', () => {
        const entity = new EntityBuilder()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' })
            .build();

        const encoded = serializer.encode(entity);
        const decoded = serializer.deocde(encoded);
        if (isLeft(decoded)) {
            fail('Expected to decode successfully');
            return;
        }

        expect(decoded.right).toEqual(entity);
    });

    it('serializes components with custom types', () => {
        const entity = new EntityBuilder()
            .setName('Test Entity')
            .addComponent(SetComponent, { s: new Set(['foo', 'bar', 'baz']) })
            .build();

        const encoded = serializer.encode(entity);
        const decoded = serializer.deocde(encoded);
        if (isLeft(decoded)) {
            fail('Expected to decode successfully');
            return;
        }

        expect(decoded.right).toEqual(entity);
    });

    it('does not include components with no serializer', () => {
        const BazComponent = new Component<{ z: number[] }>('Baz');
        const expectedEntity = new EntityBuilder()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' })
            .build();

        const inputEntity = new EntityBuilder(expectedEntity)
            .addComponent(BazComponent, { z: [1, 2, 3] })
            .build();

        const encoded = serializer.encode(inputEntity);
        const decoded = serializer.deocde(encoded);
        if (isLeft(decoded)) {
            fail('Expected to decode successfully');
            return;
        }

        expect(decoded.right).toEqual(expectedEntity);
    });

    it('allows serializing individual components', () => {
        const encoded = serializer.componentTypes.get(FooComponent)?.encode({ x: 123 });
        const decoded = serializer.componentTypes.get(FooComponent)?.decode(encoded);
        if (!decoded) {
            fail('expected decoded to be defined');
            return;
        }
        if (isLeft(decoded)) {
            fail('expect decoded to decode correctly');
            return;
        }
        expect(decoded.right).toEqual({ x: 123 });
    });
});
