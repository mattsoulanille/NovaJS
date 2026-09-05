import { isLeft } from 'fp-ts/lib/Either.js';
import { createDraft } from 'immer';
import * as t from 'io-ts';
import 'jasmine';
import { Entity } from '../entity.js';
import { Component } from '../component.js';
import { EcsEvent } from '../events.js';
import { set } from '../datatypes/set.js';
import { World } from '../world.js';
import { markerType, Serializer, SerializerPlugin, SerializerResource } from './serializer_plugin.js';


const FooComponent = new Component<{ x: number }>('Foo');
const FooType = t.type({ x: t.number });
const BarComponent = new Component<{ y: string }>('Bar');
const BarType = t.type({ y: t.string });

const SetComponent = new Component<{ s: Set<string> }>('Set');
const SetType = t.type({ s: set(t.string) });
const MarkerComponent = new Component<undefined>('Marker');
const FooEvent = new EcsEvent<{ s: Set<string> }>('FooEvent');
const FooEventType = t.type({ s: set(t.string) });


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
        serializer.addComponent(MarkerComponent, markerType);
        serializer.addEvent(FooEvent, FooEventType);
    });

    it('serializes and deserializes entities', () => {
        const entity = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' });

        const encoded = serializer.encode(entity);
        const decoded = serializer.decode(encoded);
        if (isLeft(decoded)) {
            fail('Expected to decode successfully');
            return;
        }

        expect(decoded.right.name).toEqual(entity.name);
        expect([...decoded.right.components.entries()])
            .toEqual([...entity.components.entries()]);
    });

    it('serializes components with custom types', () => {
        const entity = new Entity()
            .setName('Test Entity')
            .addComponent(SetComponent, { s: new Set(['foo', 'bar', 'baz']) });

        const encoded = serializer.encode(entity);
        const decoded = serializer.decode(encoded);
        if (isLeft(decoded)) {
            fail('Expected to decode successfully');
            return;
        }

        expect(decoded.right.name).toEqual(entity.name);
        expect([...decoded.right.components.entries()]).toEqual([...entity.components.entries()]);
    });

    it('does not include components with no serializer', () => {
        const BazComponent = new Component<{ z: number[] }>('Baz');
        const expectedEntity = new Entity()
            .setName('Test Entity')
            .addComponent(FooComponent, { x: 123 })
            .addComponent(BarComponent, { y: 'Hello' });

        const inputEntity = new Entity(expectedEntity.name, expectedEntity.components)
            .addComponent(BazComponent, { z: [1, 2, 3] });

        const encoded = serializer.encode(inputEntity);
        const decoded = serializer.decode(encoded);
        if (isLeft(decoded)) {
            fail('Expected to decode successfully');
            return;
        }

        expect(decoded.right.name).toEqual(expectedEntity.name);
        expect([...decoded.right.components.entries()])
            .toEqual([...expectedEntity.components.entries()]);
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

    it('round-trips marker components through JSON', () => {
        const entity = new Entity()
            .setName('Marker Entity')
            .addComponent(MarkerComponent, undefined);

        const encoded = serializer.encode(entity);
        const jsonRoundTripped = JSON.parse(JSON.stringify(encoded));
        const decoded = serializer.decode(jsonRoundTripped);
        if (isLeft(decoded)) {
            fail('Expected marker component to decode successfully');
            return;
        }

        expect(decoded.right.components.has(MarkerComponent)).toBeTrue();
        expect(decoded.right.components.get(MarkerComponent)).toBeUndefined();
    });

    it('serializes immer drafts to structured-cloneable data', () => {
        const entity = new Entity()
            .setName('Draft Entity')
            .addComponent(FooComponent, createDraft({ x: 123 }));

        const encoded = serializer.encode(entity);

        expect(() => structuredClone(encoded)).not.toThrow();
        const decoded = serializer.decode(encoded);
        if (isLeft(decoded)) {
            fail('Expected draft-backed component to decode successfully');
            return;
        }

        expect(decoded.right.components.get(FooComponent)).toEqual({ x: 123 });
    });

    it('serializes and deserializes events with custom types', () => {
        const encoded = serializer.encodeEvent(FooEvent, { s: new Set(['foo', 'bar']) });
        const decoded = serializer.decodeEvent(FooEvent, encoded);
        if (isLeft(decoded)) {
            fail('Expected event to decode successfully');
            return;
        }

        expect(decoded.right).toEqual({ s: new Set(['foo', 'bar']) });
    });

    // #84: the Entity guard used reduce without an initial value, which
    // throws on an entity with no components.
    it('Entity is-guard accepts a component-less entity', () => {
        expect(serializer.Entity.is(new Entity())).toBeTrue();
        expect(serializer.Entity.is(new Entity().addComponent(FooComponent, { x: 1 })))
            .toBeTrue();
        expect(serializer.Entity.is({ components: new Map([['notAComponent', 1]]) }))
            .toBeFalse();
        expect(serializer.Entity.is(null)).toBeFalse();
    });

    // #88: every restore/delta path resolves components by NAME, so a
    // second Component with the same name would silently take over the
    // wire data of the first.
    it('rejects a different component registered under an existing name', () => {
        const OtherFoo = new Component<{ x: number }>('Foo');
        expect(() => serializer.addComponent(OtherFoo, FooType))
            .toThrowError(/Foo.*already registered/);
        // The original stays bound.
        expect(serializer.componentsByName.get('Foo')).toBe(FooComponent);
    });

    it('allows re-registering the same component', () => {
        expect(() => serializer.addComponent(FooComponent, FooType)).not.toThrow();
        expect(serializer.componentsByName.get('Foo')).toBe(FooComponent);
    });
});
