import * as t from 'io-ts';
import 'jasmine';
import { Component } from '../component.js';
import { Entity } from '../entity.js';
import { World } from '../world.js';
import { SerializerPlugin, SerializerResource } from './serializer_plugin.js';
import { diffWorldHashes, hashWorld } from './world_hash.js';

const FooComponent = new Component<{ x: number }>('Foo');
const BarComponent = new Component<{ y: string }>('Bar');

describe('hashWorld', () => {
    function makeWorld() {
        const world = new World();
        world.addPlugin(SerializerPlugin);
        const serializer = world.resources.get(SerializerResource)!;
        serializer.addComponent(FooComponent, t.type({ x: t.number }));
        serializer.addComponent(BarComponent, t.type({ y: t.string }));
        return world;
    }

    it('does not depend on entity or component insertion order', () => {
        const world1 = makeWorld();
        world1.entities.set('a', new Entity('a')
            .addComponent(FooComponent, { x: 1 })
            .addComponent(BarComponent, { y: 'hi' }));
        world1.entities.set('b', new Entity('b').addComponent(FooComponent, { x: 2 }));

        const world2 = makeWorld();
        world2.entities.set('b', new Entity('b').addComponent(FooComponent, { x: 2 }));
        world2.entities.set('a', new Entity('a')
            .addComponent(BarComponent, { y: 'hi' })
            .addComponent(FooComponent, { x: 1 }));

        expect(hashWorld(world1).hash).toEqual(hashWorld(world2).hash);
        expect(diffWorldHashes(hashWorld(world1), hashWorld(world2))).toEqual([]);
    });

    it('changes when component state changes', () => {
        const world = makeWorld();
        world.entities.set('a', new Entity('a').addComponent(FooComponent, { x: 1 }));
        const before = hashWorld(world);

        world.entities.get('a')!.components.set(FooComponent, { x: 2 });
        const after = hashWorld(world);

        expect(before.hash).not.toEqual(after.hash);
        expect(diffWorldHashes(before, after)).toEqual([
            jasmine.stringContaining('a: state differs'),
        ]);
    });

    // #85: JSON.stringify collapses -0 to 0 and NaN/±Infinity to null,
    // so worlds holding different bits hashed the same. The hash must
    // distinguish exactly what the wire snapshot preserves.
    it('distinguishes -0 from +0 and non-finite values from each other', () => {
        const hashes = [-0, 0, NaN, Infinity, -Infinity].map(x => {
            const world = makeWorld();
            world.entities.set('a', new Entity('a').addComponent(FooComponent, { x }));
            return hashWorld(world).hash;
        });
        expect(new Set(hashes).size).toBe(hashes.length);
    });

    it('reports entities that only exist in one world', () => {
        const world1 = makeWorld();
        world1.entities.set('a', new Entity('a').addComponent(FooComponent, { x: 1 }));
        const world2 = makeWorld();

        expect(diffWorldHashes(hashWorld(world1), hashWorld(world2))).toEqual([
            'a: only in first world',
        ]);
    });
});
