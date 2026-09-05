import 'jasmine';
import { immerable } from 'immer';
import * as t from 'io-ts';
import { UUID } from '../arg_types.js';
import { Component } from '../component.js';
import { Entity } from '../entity.js';
import { Resource } from '../resource.js';
import { System } from '../system.js';
import { World } from '../world.js';
import { SerializerPlugin, SerializerResource } from './serializer_plugin.js';
import {
    cloneEncoded, restoreWireWorldSnapshot, restoreWorld, SnapshotPolicies,
    SnapshotPoliciesResource, snapshotWorld, wireSnapshotWorld,
} from './snapshot_plugin.js';
import { TimePlugin } from './time_plugin.js';

class Point {
    [immerable] = true;
    constructor(readonly x: number, readonly y: number) { }
    length() {
        return Math.hypot(this.x, this.y);
    }
}

class Tagged {
    get [Symbol.toStringTag]() {
        return 'Tagged';
    }
    value = 1;
}

describe('cloneEncoded', () => {
    const cases: [string, unknown][] = [
        ['undefined', undefined],
        ['null', null],
        ['number', 3.5],
        ['negative zero', -0],
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['-Infinity', -Infinity],
        ['string', 'hello'],
        ['boolean', true],
        ['bigint', 12345678901234567890n],
        ['empty object', {}],
        ['flat object', { a: 1, b: 'two', c: null, d: undefined }],
        ['nested object', { a: { b: { c: [1, { d: NaN }] } }, e: Infinity }],
        ['integer keys reorder', { b: 1, 2: 'two', a: 3, 1: 'one' }],
        ['null prototype', Object.assign(Object.create(null), { x: 1 })],
        ['class instance', new Point(1, 2)],
        ['class instances nested (MovementState-like)', {
            position: new Point(1, 2),
            velocity: new Point(0, -1),
            rotation: { angle: 0.5 },
            accelerating: 0,
            turning: 0,
            turnBack: false,
            turnTo: null,
        }],
        ['empty array', []],
        ['array of primitives', [1, 'a', null, undefined, NaN]],
        ['array of arrays', [[1, 2], [3, [4, 5]]]],
        ['array of objects', [{ a: 1 }, { b: [2] }]],
        ['sparse array', [1, , 3]], // eslint-disable-line no-sparse-arrays
        ['array with extra property', Object.assign([1, 2], { extra: 'x' })],
        ['Map', new Map<unknown, unknown>([['a', 1], [{ k: 1 }, [2]]])],
        ['Set', new Set([1, 'two', { three: 3 }])],
        ['Date', new Date(1234567890)],
        ['RegExp', /ab+c/gi],
        ['typed array', new Uint8Array([1, 2, 3])],
        ['ArrayBuffer', new Uint8Array([9, 8]).buffer],
        ['boxed number', new Number(4)],
        ['boxed string', new String('s')],
        ['tagged class instance', new Tagged()],
        ['object containing a Map', { m: new Map([['k', new Point(3, 4)]]) }],
        ['object with accessor', Object.defineProperty({ a: 1 }, 'b', {
            get: () => 2, enumerable: true,
        })],
        ['object with non-enumerable', Object.defineProperty({ a: 1 }, 'hidden', {
            value: 2, enumerable: false,
        })],
    ];

    // Jasmine's toEqual trips over Maps/Sets from node's structuredClone
    // (a different realm), so compare structure by hand.
    function describeValue(value: unknown): unknown {
        if (typeof value === 'bigint') {
            return `bigint:${value}`;
        }
        if (typeof value === 'number') {
            return Object.is(value, -0) ? '-0' : Number.isNaN(value) ? 'NaN' : value;
        }
        if (typeof value !== 'object' || value === null) {
            return value;
        }
        const tag = Object.prototype.toString.call(value);
        const proto = Object.getPrototypeOf(value);
        const protoName = proto === null ? 'null'
            : proto === Object.prototype ? 'Object' : proto.constructor?.name;
        if (value instanceof Map) {
            return { tag, protoName, entries: [...value].map(([k, v]) => [describeValue(k), describeValue(v)]) };
        }
        if (value instanceof Set) {
            return { tag, protoName, values: [...value].map(describeValue) };
        }
        if (value instanceof Date) {
            return { tag, protoName, time: value.getTime() };
        }
        if (value instanceof RegExp) {
            return { tag, protoName, source: value.source, flags: value.flags };
        }
        if (ArrayBuffer.isView(value)) {
            return { tag, protoName, bytes: [...new Uint8Array(value.buffer)] };
        }
        if (value instanceof ArrayBuffer) {
            return { tag, protoName, bytes: [...new Uint8Array(value)] };
        }
        if (Array.isArray(value)) {
            const holes: number[] = [];
            for (let i = 0; i < value.length; i++) {
                if (!(i in value)) {
                    holes.push(i);
                }
            }
            return {
                tag, protoName, length: value.length, holes,
                items: value.map(describeValue),
                extra: Object.keys(value).filter(k => !/^\d+$/.test(k))
                    .map(k => [k, describeValue((value as unknown as Record<string, unknown>)[k])]),
            };
        }
        return {
            tag, protoName,
            keys: Object.keys(value),
            props: Object.entries(value).map(([k, v]) => [k, describeValue(v)]),
            valueOf: (value instanceof Number || value instanceof String
                || value instanceof Boolean) ? value.valueOf() : undefined,
        };
    }

    for (const [name, value] of cases) {
        it(`matches structuredClone for ${name}`, () => {
            const expected = structuredClone(value);
            const actual = cloneEncoded(value);
            expect(describeValue(actual)).toEqual(describeValue(expected));
            if (typeof value === 'object' && value !== null) {
                expect(actual).not.toBe(value);
            }
        });
    }

    it('produces a detached deep copy', () => {
        const source = { a: { b: [1, { c: 2 }] }, p: new Point(1, 1) };
        const copy = cloneEncoded(source);
        copy.a.b.push(3);
        (copy.a.b[1] as { c: number }).c = 99;
        (copy.p as unknown as { x: number }).x = 42;
        expect(source.a.b).toEqual([1, { c: 2 }]);
        expect(source.p.x).toBe(1);
    });

    it('preserves array holes and extra properties like structuredClone', () => {
        const sparse = cloneEncoded([1, , 3]); // eslint-disable-line no-sparse-arrays
        expect(1 in sparse).toBeFalse();
        const extra = cloneEncoded(Object.assign([1], { tag: 't' })) as number[] & { tag: string };
        expect(extra.tag).toBe('t');
    });

    it('preserves shared references and cycles like structuredClone', () => {
        const shared = { n: 1 };
        const source: { a: typeof shared, b: typeof shared, self?: unknown } =
            { a: shared, b: shared };
        source.self = source;
        const copy = cloneEncoded(source);
        // One shared object in, one shared object out.
        expect(copy.a).toBe(copy.b);
        expect(copy.a).not.toBe(shared);
        expect(copy.self).toBe(copy);
        // Same as the reference implementation.
        const ref = structuredClone(source);
        expect(ref.a).toBe(ref.b);
        expect(ref.self).toBe(ref);
        // Deep nesting stays linear (no exponential re-cloning of shared
        // subtrees).
        const leaf = { v: [1, 2, 3] };
        const wide = Array.from({ length: 200 }, () => leaf);
        const wideCopy = cloneEncoded(wide);
        expect(new Set(wideCopy).size).toBe(1);
    });

    it('rejects what structuredClone rejects', () => {
        expect(() => cloneEncoded(() => 1)).toThrowError(/could not be cloned|DataCloneError/i);
        expect(() => cloneEncoded({ f: () => 1 })).toThrowError(/could not be cloned|DataCloneError/i);
        expect(() => cloneEncoded(Symbol('s') as unknown))
            .toThrowError(/could not be cloned|DataCloneError/i);
    });
});

describe('snapshotWorld queued-event invariant', () => {
    function makeWorld(): World {
        const world = new World('snapshot invariant test');
        world.addPlugin(TimePlugin);
        world.resources.set(SnapshotPoliciesResource, new SnapshotPolicies());
        return world;
    }

    it('warns when a stepped world has queued events', () => {
        const world = makeWorld();
        world.step();
        // Inserting an entity queues an AddEvent the next step flushes;
        // a snapshot here would silently lose it across a restore.
        world.entities.set('e', new Entity());
        const warn = spyOn(console, 'warn');
        snapshotWorld(world);
        expect(warn).toHaveBeenCalledWith(
            jasmine.stringMatching(/queued event/));
        // Once per world, so the check never spams.
        warn.calls.reset();
        snapshotWorld(world);
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn between steps, when the queue is empty', () => {
        const world = makeWorld();
        world.entities.set('e', new Entity());
        world.step();
        const warn = spyOn(console, 'warn');
        snapshotWorld(world);
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn for the genesis snapshot of a never-stepped world', () => {
        // World-build entity insertion queues AddEvents that the first
        // step will flush; the genesis snapshot (taken before any step)
        // is the documented exception to the empty-queue invariant.
        const world = makeWorld();
        world.entities.set('e', new Entity());
        const warn = spyOn(console, 'warn');
        snapshotWorld(world);
        expect(warn).not.toHaveBeenCalled();
    });
});

const NumComponent = new Component<{ v: number }>('Num');
const SkippedComponent = new Component<{ live: number }>('Skipped');
const UnregisteredComponent = new Component<{ u: number }>('Unregistered');

function makeSerializedWorld(): World {
    const world = new World('snapshot restore test');
    world.addPlugin(SerializerPlugin);
    world.resources.get(SerializerResource)!
        .addComponent(NumComponent, t.type({ v: t.number }));
    world.resources.get(SerializerResource)!
        .addComponent(SkippedComponent, t.type({ live: t.number }));
    const policies = new SnapshotPolicies();
    policies.set(SkippedComponent, { policy: 'skip' });
    world.resources.set(SnapshotPoliciesResource, policies);
    return world;
}

// #85: the in-memory snapshot preserves -0 but the wire snapshot went
// through JSON, which serializes -0 as 0, so a late joiner held +0 where
// every other peer held -0.
describe('wire snapshot sign of zero', () => {
    it('preserves -0 across a JSON roundtrip', () => {
        const world = makeSerializedWorld();
        world.entities.set('e', new Entity().addComponent(NumComponent, { v: -0 }));
        const wire = JSON.parse(JSON.stringify(wireSnapshotWorld(world)));

        const restored = makeSerializedWorld();
        restoreWireWorldSnapshot(restored, wire);
        const v = restored.entities.get('e')!.components.get(NumComponent)!.v;
        expect(Object.is(v, -0)).toBeTrue();
    });

    it('still preserves +0 and non-finite values', () => {
        const world = makeSerializedWorld();
        world.entities.set('zero', new Entity().addComponent(NumComponent, { v: 0 }));
        world.entities.set('inf', new Entity().addComponent(NumComponent, { v: -Infinity }));
        world.entities.set('nan', new Entity().addComponent(NumComponent, { v: NaN }));
        const wire = JSON.parse(JSON.stringify(wireSnapshotWorld(world)));

        const restored = makeSerializedWorld();
        restoreWireWorldSnapshot(restored, wire);
        const get = (uuid: string) =>
            restored.entities.get(uuid)!.components.get(NumComponent)!.v;
        expect(Object.is(get('zero'), 0)).toBeTrue();
        expect(get('inf')).toBe(-Infinity);
        expect(get('nan')).toBeNaN();
    });
});

// #41: restore rebuilt every query entry in world order, while a live
// world's entry held members in the order they gained the query's
// components — so the peer that rolled back visited entities in a
// different order from one that ran straight through (and from a late
// joiner). Same world state must mean the same order everywhere.
describe('per-entity system order survives snapshot and restore', () => {
    const VisitedResource = new Resource<string[]>('Visited');
    const VisitSystem = new System({
        name: 'Visit',
        args: [UUID, NumComponent, VisitedResource] as const,
        step: (uuid, _num, visited) => {
            visited.push(uuid);
        },
    });

    function makeVisitWorld(): World {
        const world = makeSerializedWorld();
        world.resources.set(VisitedResource, []);
        world.addSystem(VisitSystem);
        return world;
    }

    function visitOrder(world: World): string[] {
        const visited = world.resources.get(VisitedResource)!;
        visited.length = 0;
        world.step();
        return [...visited];
    }

    it('is the same live, after an in-memory restore, and for a wire late joiner', () => {
        const world = makeVisitWorld();
        world.entities.set('a', new Entity().addComponent(NumComponent, { v: 0 }));
        world.entities.set('b', new Entity().addComponent(NumComponent, { v: 0 }));
        world.step();
        // 'a' leaves the query and rejoins.
        world.entities.get('a')!.components.delete(NumComponent);
        world.entities.get('a')!.components.set(NumComponent, { v: 0 });
        world.step();

        const live = visitOrder(world);

        const snapshot = snapshotWorld(world);
        const wire = JSON.parse(JSON.stringify(wireSnapshotWorld(world)));

        restoreWorld(world, snapshot);
        const rolledBack = visitOrder(world);

        const joiner = makeVisitWorld();
        restoreWireWorldSnapshot(joiner, wire);
        const lateJoined = visitOrder(joiner);

        expect(rolledBack).toEqual(live);
        expect(lateJoined).toEqual(live);
        expect(live).toEqual(['a', 'b']);
    });
});

// #86: non-singleton entities are rebuilt from scratch on restore, but
// the singleton is mutated in place and kept any component attached
// after the snapshot was taken.
describe('restore prunes post-snapshot singleton components', () => {
    it('removes a captured component the snapshot does not hold (in-memory)', () => {
        const world = makeSerializedWorld();
        const snapshot = snapshotWorld(world);
        world.singletonEntity.components.set(NumComponent, { v: 5 });

        restoreWorld(world, snapshot);
        expect(world.singletonEntity.components.has(NumComponent)).toBeFalse();
    });

    it('removes a captured component the snapshot does not hold (wire)', () => {
        const world = makeSerializedWorld();
        const wire = JSON.parse(JSON.stringify(wireSnapshotWorld(world)));
        world.singletonEntity.components.set(NumComponent, { v: 5 });

        restoreWireWorldSnapshot(world, wire);
        expect(world.singletonEntity.components.has(NumComponent)).toBeFalse();
    });

    it('restores a captured component the snapshot does hold', () => {
        const world = makeSerializedWorld();
        world.singletonEntity.components.set(NumComponent, { v: 1 });
        const snapshot = snapshotWorld(world);
        world.singletonEntity.components.set(NumComponent, { v: 2 });

        restoreWorld(world, snapshot);
        expect(world.singletonEntity.components.get(NumComponent)).toEqual({ v: 1 });
    });

    it("keeps 'skip'-policy and unregistered singleton components", () => {
        // 'skip' means "not simulation state, keep the live value", and
        // an unregistered component has nothing to be restored from.
        const world = makeSerializedWorld();
        const snapshot = snapshotWorld(world);
        world.singletonEntity.components.set(SkippedComponent, { live: 7 });
        world.singletonEntity.components.set(UnregisteredComponent, { u: 8 });

        restoreWorld(world, snapshot);
        expect(world.singletonEntity.components.get(SkippedComponent)).toEqual({ live: 7 });
        expect(world.singletonEntity.components.get(UnregisteredComponent)).toEqual({ u: 8 });
    });
});
